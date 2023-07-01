//
// SunSynk data logger

// Last used access token
let accessToken = null

// Start
async function start() {

    // Starting
    console.log('Starting SunSynk data logger...')

    // Run an iteration every minute
    while (true) {

        // Run an iteration
        try {
            await runIteration()
        } catch (err) {
            console.warn(`Update failed: ${err.message}`)
            accessToken = null
        }

        // Wait a minute
        await new Promise(c => setTimeout(c, 60 * 1000))

    }

}

// Main iteration
async function runIteration() {

    // Get config values that the user specified in the HomeAssistant UI
    const options = require('/data/options.json')
    
    // Log in if needed
    if (!accessToken) {

        // Log in
        console.log('Logging in...')
        let login = await api('POST', '/oauth/token', {
            areaCode: 'sunsynk',                            // Region2 (?)
            client_id: 'csp-web',
            grant_type: 'password',
            source: 'sunsynk',
            username: options.account_email,
            password: options.account_password
        })

        // Get access token
        accessToken = login.access_token
        if (!accessToken)
            throw new Error('No access token returned.')

    }

    // Fetch the first plant, or the one with the matching name specified in the config
    // Plant info:
    // - id
    // - status == 1 (online)
    // - name
    // - pac (generation in wattage)
    // - updateAt (last update time)
    let plants = await api('GET', '/api/v1/plants?page=1&limit=10&name=&status=', null, accessToken)
    let plant = options.plant_name ? plants.infos?.find(p => p.name == options.plant_name) : plants.infos?.[0]
    if (!plant)
        throw new Error(options.plant_name ? `Plant '${options.plant_name}' not found on this account.` : 'No plants found on this account.')

    // Fetch inverter data
    let inverters = await api('GET', `/api/v1/plant/${plant.id}/inverters?page=1&limit=1&status=-1&sn=&id=${plant.id}&type=-2`, null, accessToken)
    let inverter = inverters.infos?.[0]
    if (!inverter)
        throw new Error(`No inverters found on plant '${plant.name || plant.id}'`)

    // Fetch battery data
    let battery = await api('GET', `/api/v1/inverter/battery/${inverter.sn}/realtime?sn=${inverter.sn}&lan=en`, null, accessToken)
    let batteryPercent = parseFloat(battery.soc)
    // let batteryDischarging = battery.power > 0

    // Fetch load data
    let load = await api('GET', `/api/v1/inverter/load/${inverter.sn}/realtime?sn=${inverter.sn}`, null, accessToken)

    // Fetch grid data
    let grid = await api('GET', `/api/v1/inverter/grid/${inverter.sn}/realtime?sn=${inverter.sn}`, null, accessToken)

    // Update HomeAssistant entities
    if (options.entity_solar_power) await updateNumberHelper(options.entity_solar_power, inverter.pac)
    if (options.entity_grid_power) await updateNumberHelper(options.entity_grid_power, grid.pac)
    if (options.entity_load_power) await updateNumberHelper(options.entity_load_power, load.totalPower)
    if (options.entity_battery_power) await updateNumberHelper(options.entity_battery_power, battery.power)
    if (options.entity_battery_percent) await updateNumberHelper(options.entity_battery_percent, battery.soc)

    // Done
    console.log(`Updated: solar=${inverter.pac}W grid=${grid.pac}W load=${load.totalPower}W battery=${battery.power}W ${battery.soc}%`)

}

// Send an API request
async function api(method, endpoint, data, accessToken) {

    // Send the request
    const apiServer = 'https://api.sunsynk.net'
    let response = await fetch(apiServer + endpoint, {
        method,
        headers: {
            'Content-Type': data ? 'application/json' : undefined,
            'Authorization': accessToken ? `Bearer ${accessToken}` : undefined,
        },
        body: data ? JSON.stringify(data) : undefined
    })

    // Decode JSON
    let str = await response.text()
    let json = {}
    try {
        json = JSON.parse(str)
    } catch {}

    // Check for error
    if (!response.ok || !json.success)
        throw new Error(json?.msg || `API request ${endpoint} failed: ${response.status} ${response.statusText} - ${str}`)

    // Done
    return json.data

}

// Update a HomeAssistant Number Helper entity
async function updateNumberHelper(entity_id, value) {

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