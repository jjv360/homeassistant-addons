//
// Hubble CLoudlink data logger

const WebSocket = require('ws')
const { dataKeys } = require('./dataKeys')

// Get config values that the user specified in the HomeAssistant UI
let options = null
try {
    options = require('/data/options.json')
} catch (err) {
    options = require('../local.options.json')
}

// Start
async function start() {

    // Starting
    console.log('Starting Hubble Cloudlink data logger...')

    // Run an iteration every minute
    while (true) {

        // Run an iteration
        try {
            await runIteration()
        } catch (err) {
            console.warn(`Update failed: ${err.message}`)
        }

        // Wait a minute
        console.log('Connection reset! Waiting a bit to try again...')
        await new Promise(c => setTimeout(c, 5 * 1000))

    }

}

// Main iteration
async function runIteration() {
        
    // Log in
    console.log('Logging in...')
    let login = await fetch("https://portal.riotsystems.cloud/api/auth/login", {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            username: options.account_email,
            password: options.account_password,
        })
    }).then(r => r.json())

    // Get access token
    let accessToken = login.token
    if (!accessToken)
        throw new Error('No access token returned.')

    // Fetch dashboards
    // console.log('Fetching dashboards...')
    // let dashboards = await fetch("https://portal.riotsystems.cloud/api/user/dashboards?pageSize=100&page=0", {
    //     "headers": {
    //         "content-type": "application/json",
    //         "x-authorization": "Bearer " + accessToken
    //     },
    // }).then(r => r.json())

    // // Get the first dashboard
    // let dashboard = dashboards.data.find(d => d.name?.includes('PowerFlow')) || dashboards.data[0]

    // // Get dashboard info
    // console.log(`Fetching dashboard ${dashboard.id.id} (${dashboard.title})...`)
    

    // Create pending promise
    let promiseResolve = null
    let promise = new Promise(resolve => promiseResolve = resolve)

    // Connect to websocket
    console.log('Opening WebSocket...')
    const ws = new WebSocket('wss://portal.riotsystems.cloud/api/ws/plugins/telemetry?token=' + accessToken)

    // Called on WebSocket connection open
    ws.on('open', function open() {

        // Filter data keys to only attributes and time series
        console.log('WebSocket connected!')
        let dataKeysFiltered = dataKeys.filter(dataKey => dataKey.type == 'attribute' || dataKey.type == 'timeseries')

        // Send subscription request for the attributes we want
        ws.send(JSON.stringify({
            "attrSubCmds": [],
            "tsSubCmds": [],
            "historyCmds": [],
            "entityDataCmds": [

                // First send a query command
                {
                    cmdId: 1,
                    query: {
                        entityFilter: {
                            type: "singleEntity",
                            singleEntity: {
                                id: options.device_id,
                                entityType: "DEVICE"
                            }
                        },
                        pageLink: {
                            pageSize: 1,
                            page: 0,
                        },
                        latestValues: dataKeysFiltered.map(dataKey => ({
                            type: dataKey.type == 'attribute' ? "ATTRIBUTE" : "TIME_SERIES",
                            key: dataKey.name
                        }))
                    }
                },

                // Then send a request to receive continuous updates for the above command
                {
                    cmdId: 1,
                    latestCmd: {
                        keys: dataKeysFiltered.map(dataKey => ({
                            type: dataKey.type == 'attribute' ? "ATTRIBUTE" : "TIME_SERIES",
                            key: dataKey.name
                        }))
                    }
                }

            ],
            "entityDataUnsubscribeCmds": [],
            "alarmDataCmds": [],
            "alarmDataUnsubscribeCmds": [],
            "entityCountCmds": [],
            "entityCountUnsubscribeCmds": []
        }))

    })

    // Called when the socket closes
    ws.on('close', function(code, reason) {

        // Resolve the promise
        console.log(`Connection closed! code=${code}, reason=${reason}`)
        promiseResolve()

    })

    // On error, log it
    ws.on('error', err => {
        console.log('Connection error:', err)
    })

    // Called on message received
    ws.on('message', function message(data) {

        // Catch errors
        try {

            // Parse message
            let json = JSON.parse(data.toString())

            // Check incoming attributes
            let didProcessData = false
            for (let item of json.data?.data || json.update || []) {

                // Go through attributes
                for (let key in item.latest.ATTRIBUTE || {}) {

                    // Get item value
                    let value = item.latest.ATTRIBUTE[key].value
                    notifyAttributeUpdate(key, value)
                    didProcessData = true

                }

                // Go through time series data
                for (let key in item.latest.TIME_SERIES || {}) {

                    // Get item value
                    let value = item.latest.TIME_SERIES[key].value
                    notifyAttributeUpdate(key, value)
                    didProcessData = true

                }

            }

            // Failed if no data processed
            if (!didProcessData)
                console.warn('Incoming message with no data received.')

        } catch (err) {

            // Log it
            console.warn('Error parsing message:', err, data.toString())

        }

    })

    // Wait here until the connection is broken
    await promise

}

// Notify update to an attribute
async function notifyAttributeUpdate(attribute, value) {

    // Get Hubble entity to HomeAssistant entity map
    let entityMap = {
        Sys_P_PV: options.entity_solar_power || '',
        Sys_SOC: options.entity_battery_percent || '',
        Sys_P_Bat: options.entity_battery_power || '',
        Sys_P_Grid: options.entity_grid_power || '',
        Sys_P_Load: options.entity_load_power || '',
    }

    // Find entity description
    let dataKey = dataKeys.find(k => k.name == attribute)

    // Log it
    if (entityMap[attribute] !== undefined)
        console.log(`Attribute update: ${attribute} (${dataKeys.find(k => k.name == attribute)?.label || '?'}) = ${value} ${dataKey?.units || ''}    ${entityMap[attribute] || ''}`)

    // Check if we have a HomeAssistant entity for this attribute
    if (entityMap[attribute])
        updateNumberHelper(entityMap[attribute], value)

}

// Update a HomeAssistant Number Helper entity
async function updateNumberHelper(entity_id, value) {

    // Stop if entity ID is blank
    if (!entity_id)
        return

    // Send request
    let response = await fetch('http://supervisor/core/api/services/input_number/set_value', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.SUPERVISOR_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            entity_id, 
            value: value || 0
        })
    })

    // Check response
    if (!response.ok)
        throw new Error(`Unable to update ${entity_id}: ${response.status} ${response.statusText}`)

}

start()