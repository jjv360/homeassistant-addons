ARG BUILD_FROM
FROM $BUILD_FROM

# Install NPM
RUN apk add --no-cache nodejs npm

# Install modules
COPY package.json /
COPY package-lock.json /
RUN npm install

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

# Copy app code
COPY src/ /src/

CMD [ "/run.sh" ]