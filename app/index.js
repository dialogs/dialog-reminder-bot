const dotenv = require("dotenv");
const Bot = require("@dlghq/dialog-bot-sdk");
const {
  MessageAttachment,
  ActionGroup,
  Action,
  Button,
  Select,
  SelectOption,
  Peer,
  PeerType,
  UUID
} = require("@dlghq/dialog-bot-sdk");
const { flatMap } = require("rxjs/operators");
const { merge } = require("rxjs");
const moment = require("moment");
const _ = require("lodash");
const timeOptions = require("./timeOptions");
const sqlite3 = require('sqlite3');
const Long = require('long');

let reminders = {};

const MINUTE = 60000;
const OLD_MESSAGE = 60 * MINUTE;
const OLD_DROP_TIMER = 24 * 60 * MINUTE;
const TIME_TO_SEARCH = 1 * MINUTE;

const LOCALE = {
  start: {
    en: "Hello! I'm  reminder bot. I can remind you any message before after time!",
    ru: "Привет! Я бот-напоминалка. Я могу напомнить о Вашем сообщении через некоторое время!"
  },
  schedule: {
    en: "Your mentions have been scheduled",
    ru: "Я запланировал Ваше напоминание"
  },
  reminderReceived: {
    en: "Ok! When do you need me to remind you of this?",
    ru: "Когда мне нужно напомнить об этом?"
  },
  remind: {
    en: "Hey! You asked to remind:",
    ru: "Вы просили напомнить:"
  },
  choose: {
    en: "Choose time:",
    ru: "Выберете время"
  },
  tryAgain: {
    en: "Selected time has passed, try again",
    ru: "Назначенное время прошло, попробуйте ещё раз"
  },
  noActual: {
    en: "The message is no longer actual",
    ru: "Сообщение больше не актуально"
  },
  half: {
    en: "In 30 minutes",
    ru: "Через 30 минут"
  },
  oneHour: {
    en: "In an hour",
    ru: "Через час"
  },
  twoHours: {
    en: "In 2 hours",
    ru: "Через 2 часа"
  },
  tomorrow: {
    en: "Tomorrow",
    ru: "Завтра"
  },
  week: {
    en: "A week Later",
    ru: "Через неделю"
  },
  specify: {
    en: "Specify Time",
    ru: "Назначить время"
  },
  hour: {
    en: "Hours",
    ru: "Часы"
  },
  minute: {
    en: "Minutes",
    ru: "Минуты"
  }
};

const DEFAULT_LANG = 'en';
const LANGUAGES = ['en', 'ru'];

dotenv.config();

function getButtons(lang) {
  return [
    { type: "button", id: "30 mins", label: LOCALE.half[lang] },
    { type: "button", id: "1 hour", label: LOCALE.oneHour[lang] },
    { type: "button", id: "2 hours", label: LOCALE.twoHours[lang] },
    { type: "button", id: "tomorrow", label: LOCALE.tomorrow[lang] },
    { type: "button", id: "1 week", label: LOCALE.week[lang] },
    { type: "button", id: "selectTime", label: LOCALE.specify[lang] }
  ];
}

function getSelect(lang) {
  return [
    {
      type: "select",
      id: "Hour",
      label: LOCALE.hour[lang],
      options: timeOptions.time.hours
    },
    {
      type: "select",
      id: "Minutes",
      label: LOCALE.minute[lang],
      options: timeOptions.time.minutes
    }
  ];
}

//token to connect to the bot
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint = process.env.BOT_ENDPOINT;

// async function run(token, endpoint) {
const bot = new Bot.default({
  token,
  endpoints: [endpoint]
});

//fetching bot name
const self = bot
  .getSelf()
  .then(response => {
    console.log(`I've started, post me something @${response.nick}`);
  })
  .catch(err => console.log(err));

bot.updateSubject.subscribe({
  next(update) {}
});

/*  -----


subscribing to incoming messages


------ */

const messagesHandle = bot.subscribeToMessages().pipe(
  flatMap(async message => {
      if (message.peer.type === "private" && message.content.type === "text") {
        const lang = await getCurrentUserLang(message.peer.id);
        if (message.content.text === "/start")
          return sendTextMessage(message.peer, LOCALE.start[lang]);
        let messageIds = {};
        messageIds["user_msg"] = message.id;
        const text = LOCALE.reminderReceived[lang];
        const sendMessage = await sendTextMessage(message.peer, text, getButtons(lang), message.id);
        messageIds["self_msg"] = sendMessage.id;
        messageIds["lang"] = lang;
        messageIds["timestamp"] = Date.now();
        if (reminders[message.peer.id] === undefined) reminders[message.peer.id] = [];
        reminders[message.peer.id].push(messageIds);
    }
  })
);

//creating action handle
const actionsHandle = bot.subscribeToActions().pipe(
  flatMap(async event => {
    console.log("EVENT", event);
    const peer = new Peer(event.uid, PeerType.PRIVATE);
    const lang = await getCurrentUserLang(event.uid);
    const now = new Date();
    let specifiedTime = null;

    if (!validateEvent(event.uid, event.mid))
      return bot.editText(event.mid, now, LOCALE.noActual[lang]).catch(err => console.log(`editText failed: `, err));

    if (event.id === "Hour") specifiedTime = addSpecifiedTime(event.mid, event.uid, event.value, null);
    if (event.id === "Minutes") specifiedTime = addSpecifiedTime(event.mid, event.uid,null, event.value);
    if (specifiedTime !== null) {
      bot.editText(event.mid, now, LOCALE.choose[lang]).catch(err => console.log(`editText failed: `, err));
      return scheduleCustomReminder(specifiedTime.hour, specifiedTime.minutes, peer, event.mid);
    }

    if (event.id === "30 mins") {
      scheduleReminder(30, peer, event.mid);
    } else if (event.id === "1 hour") {
      scheduleReminder(60, peer, event.mid);
    } else if (event.id === "2 hours") {
      scheduleReminder(120, peer, event.mid);
    } else if (event.id === "tomorrow") {
      scheduleReminder(60 * 24, peer, event.mid);
    } else if (event.id === "1 week") {
      scheduleReminder(60 * 24 * 7, peer, event.mid);
    } else if (event.id === "selectTime") {
      const sendMessage = await sendTextMessage(peer, LOCALE.choose[lang], getSelect(lang), event.mid);
      replaceMid(event.uid, event.mid, sendMessage.id);
    }
    if (event.id !== "Hour" && event.id !== "Minutes")
      await bot.editText(event.mid,
          now,
          LOCALE.reminderReceived[lang])
          .catch(err => console.log(`editText failed: `, err));

  })
);

// merging actionHandle with messageHandle
new Promise((resolve, reject) => {
  merge(messagesHandle, actionsHandle).subscribe({
    error: reject,
    complete: resolve
  });
})
  .then(response => console.log(response))
  .catch(err => console.log(err));

/* -------

action handle functions

------ */
function scheduleReminder(time, peer, mid) {
  console.log("Schedule reminder got called", time , peer, mid);
  const timeLeft = time * MINUTE; //milliseconds
  const messageIds = findMessageIdsAndDrop(mid, peer.id);
  const msb = messageIds.user_msg.msb;
  const lsb = messageIds.user_msg.lsb;
  const lang = messageIds.lang;
  console.log("in scheduleReminder", Date.now() + timeLeft);
  insertDb(peer.id, String(msb), String(lsb), Date.now() + timeLeft, lang);
  const successResponse = LOCALE.schedule[messageIds.lang];
  sendTextMessage(peer, successResponse);
}

function scheduleCustomReminder(hour, min, peer, mid) {
  console.log("Schedule custom reminder got called", hour, min, peer);
  const time = hour + ":" + min;
  const scheduledTime = moment(time, "HH:mm").format("HH:mm");
  const now = moment(Date.now()).format("HH:mm");
  const timeLeft = moment(scheduledTime, "HH:mm").diff(moment(now, "HH:mm"));
  console.log("time", time);
  console.log("scheduledTime", scheduledTime);
  console.log("now", now);
  console.log("timeLeft", timeLeft);
  if (timeLeft < 0) {
    const messageIds = findMessageIdsAndDrop(mid, peer.id);
    sendTextMessage(peer, LOCALE.tryAgain[messageIds.lang]);
  } else {
    scheduleReminder(timeLeft / MINUTE, peer, mid);
  }
}

/* -------

message handle functions

------ */

//general functions
function selectOptionFormat(options) {
  let selectOptions = [];
  options.map(option => {
    selectOptions.push(new SelectOption(option.label, option.value));
  });

  return selectOptions;
}

//actionOptions is an array of format [{type:"", id: "", label: "", options: ""}]
function actionFormat(actionOptions) {
  let actions = [];
  actionOptions.map(options => {
    if (options.type === "select") {
      const selectOptions = selectOptionFormat(options.options);

      let action = Action.create({
        id: options.id,
        widget: Select.create({
          label: options.label,
          options: selectOptions
        })
      });

      actions.push(action);
    } else if (options.type === "button") {
      let action = Action.create({
        id: options.id,
        widget: Button.create({ label: options.label })
      });

      actions.push(action);
    }
  });

  return actions;
}

//actions is an array of format [{type:"" , id: "" , label: "" , options: ""}]
function sendTextMessage(peer, text, actions, reply) {
  let messageToSend = messageFormat(text, peer);
  let action = actions || null;
  let actionGroup = null;
  if (action !== null) {
    actionGroup = ActionGroup.create({
      actions: actionFormat(action)
    });
  }
  return sendTextToBot(messageToSend, actionGroup, reply);
}

function messageFormat(text, peer) {
  let message = { peer: peer, text: text };
  return message;
}

function sendTextToBot(message, actionGroup, reply) {
  let actionGroups = actionGroup || null;
  return bot
    .sendText(
      message.peer,
      message.text,
      MessageAttachment.reply(reply),
      actionGroups
    ).catch(err => console.log(`sendText failed: `, err));
}

function findMessageIdsAndDrop(mid, uid) {
  for (let i=0; i < reminders[uid].length; i++) {
    if (equalMid(reminders[uid][i].self_msg, mid)) {
      const result = reminders[uid][i];
      reminders[uid][i] = reminders[uid][0];
      reminders[uid] = reminders[uid].splice(1);
      return result;
    }
  }
}

function replaceMid(uid, mid, new_mid) {
  for (let i=0; i < reminders[uid].length; i++) {
    if (equalMid(reminders[uid][i].self_msg, mid)) {
      reminders[uid][i].self_msg = new_mid;
      return null;
    }
  }
}

function addSpecifiedTime(mid, uid, hour, minutes) {
  for (let i=0; i < reminders[uid].length; i++) {
    if (equalMid(reminders[uid][i].self_msg, mid)) {
      if (hour === null)
        reminders[uid][i].minutes = minutes;
      else
        reminders[uid][i].hour = hour;
      if (reminders[uid][i].hour !== undefined && reminders[uid][i].minutes !== undefined)
        return reminders[uid][i];
      else
        return null;
    }
  }
}

setInterval(async function() {
  const now = Date.now();
  for (let key in reminders) {
    let cut = 0;
    for (let i=0; i < reminders[key].length; i++) {
      if (moment(now).diff(reminders[key][i].timestamp) > OLD_MESSAGE) {
        bot.editText(reminders[key][i].self_msg, new Date(), LOCALE.noActual[reminders[key][i].lang])
            .catch(err => console.log(`editText failed: `, err));
        reminders[key][i] = reminders[key][cut];
        cut++;
      }
    }
    reminders[key] = reminders[key].splice(cut);
  }
}, OLD_DROP_TIMER);

setInterval(async function() {
  findMessagesToSend(Date.now())
}, TIME_TO_SEARCH);

async function getCurrentUserLang(uid) {
    const user = await bot.loadFullUser(uid);
    let res = "";
    user.preferredLanguages
        .map(l => l.toLowerCase().trim().replace('-', '_').split('_')[0])
        .forEach(lang =>
            LANGUAGES.forEach(default_lang => {
                if (lang === default_lang) res = lang;
            })
        );
    return res || DEFAULT_LANG;
}

function equalMid(mid1, mid2) {
  return String(mid1.msb) === String(mid2.msb) &&
      String(mid1.lsb) === String(mid2.lsb);
}

function validateEvent(uid, mid) {
  if (reminders[uid] === undefined) return false;
  for (let i=0; i < reminders[uid].length; i++){
    if (equalMid(reminders[uid][i].self_msg, mid))
      return true;
  }
  return false;
}
// database methods block

const db = new sqlite3.Database("./messages.db", (err) => {
  if (err) {
    console.log('Could not connect to database', err)
  } else {
    console.log('Connected to database')
  }
});

createTable();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        console.log('Error running sql ' + sql);
        console.log(err);
        reject(err)
      } else {
        console.log('Done running sql ' + sql);
      }
    })
  })
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.log('Error running sql: ' + sql);
        console.log(err);
        reject(err)
      } else {
        resolve(rows)
      }
    })
  });
}

function createTable() {
  const sql = `CREATE TABLE IF NOT EXISTS Messages (
    uid INTEGER,
    msb TEXT,
    lsb TEXT,
    timestamp INTEGER,
    lang TEXT)`;
  run(sql);
}

function insertDb(uid, msb, lsb, timestamp, lang) {
  const sql = "INSERT INTO Messages (uid, msb, lsb, timestamp, lang) values(?, ?, ?, ?, ?)";
  run(sql, [uid, msb, lsb, timestamp, lang]);
}

function findMessagesToSend(timestamp) {
  const sql = "SELECT * FROM Messages where timestamp < ?";
  all(sql, [timestamp]).then(result => sendMessages(result)).catch(err => console.log("err", err));
}

function sendMessages(result) {
  result.forEach(res => {
    const peer = new Peer(res.uid, PeerType.PRIVATE);
    const mid = new UUID(Long.fromString(String(res.msb)), Long.fromString(String(res.lsb)));
    sendTextMessage(peer, LOCALE.remind[res.lang], null, mid);
    deleteSentMessages(res.msb, res.lsb);
  })
}

function deleteSentMessages(msb, lsb) {
  const sql = "DELETE FROM Messages where msb = ? and lsb = ?";
  const result = run(sql, [msb, lsb]);
}