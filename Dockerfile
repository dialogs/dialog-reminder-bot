FROM node:10

WORKDIR /opt/reminder-bot

COPY . .

RUN npm install

ENV BOT_ENDPOINT=$BOT_ENDPOINT
ENV BOT_TOKEN=$BOT_TOKEN

CMD ["node", "app/index.js"]
