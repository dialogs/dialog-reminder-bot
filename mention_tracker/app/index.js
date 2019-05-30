const dotenv = require("dotenv");
const Bot = require("@dlghq/dialog-bot-sdk");
const Rpc = require("@dlghq/dialog-bot-sdk");
const {
  MessageAttachment,
  ActionGroup,
  Action,
  Button,
  Select,
  SelectOption
} = require("@dlghq/dialog-bot-sdk");
const { flatMap } = require("rxjs/operators");
const { merge } = require("rxjs");
const moment = require("moment");
var _ = require("lodash");
var timeOptions = require("./timeOptions");

const selectOptionsTime = [
  {
    type: "select",
    id: "Hour",
    label: "Hour",
    options: timeOptions.time.hours
  },
  {
    type: "select",
    id: "Minutes",
    label: "Mins",
    options: timeOptions.time.minutes
  }
];
var mentions = [];
var addedToGroups = [];
var groupsToTrack = [];
const trackableUsers = [];
var specifiedTime = { hour: null, min: null };
var scheduledTime = "";

dotenv.config();

//token to connect to the bot
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint =
  process.env.BOT_ENDPOINT || "https://grpc-test.transmit.im:9443";


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
  next(update) {
    // console.log(JSON.stringify({ update }, null, 2));
  }
});

bot.ready.then(response => {
  //mapping the groups the bot has been added to
  response.groups
    .forEach(group => {
      const newGroup = { id: group.id, name: group.title };
      addedToGroups.push(newGroup);
    })
    addBotToTrackableGroups();
});

//subscribing to incoming messages
const messagesHandle = bot.subscribeToMessages().pipe(
  flatMap(async message => {
    const wordsArray = message.content.text.split(" ");
    const content = message.content;
    const peer = message.peer;
    //conditions to check for user mentions.
    if (
      peer.type === "private" &&
      content.text === process.env.TRACK_MENTIONS
    ) {
      const user = await getCurrentUser(bot , message.peer);
      trackableUsers.push(user);
      
    } else if (
      content.type === "text" &&
      peer.type === "group" &&
      containsValue(groupsToTrack, peer.id) === true 
    ) {
      //checking if mentioned user is a part of users whose mentions are to be tracked.
        wordsArray.map(word =>{   
           if(_.find(trackableUsers , ['nick', word])){             
             addMentions(message);
           }
        });
    } else if (
      content.type === "text" &&
      peer.type === "private" &&
      content.text === process.env.STOP_TRACK_MENTIONS
    ) {
      groupsToTrack = [];
    } else if (
      content.type === "text" &&
      peer.type === "private" &&
      content.text === process.env.SCHEDULE_MENTIONS
    ) {
      sendTextMessage("Choose Time", message.peer, selectOptionsTime);
    } else if (
      content.type === "text" &&
      peer.type === "private" &&
      content.text === process.env.LIST_MENTIONS
    ) {      
      const user = _.find(trackableUsers , [`peer['id']` , message.peer.id ]);
      if (user) listMentions(bot , user);
      else if (!user) {
        message.text =
        `Mentions tracking is turned off, To turn it on type "${process.env.TRACK_MENTIONS}" without the qoutes`;
        sendTextToBot(bot, message);
      } 
      
    } else if (
      content.type === "text" &&
      peer.type === "private" &&
      content.text === process.env.SUBSCRIPTIONS
    ) {
      listBotGroupSubscriptions(bot, message);
    }
  })
);

//creating action handle
const actionsHandle = bot.subscribeToActions().pipe(
  flatMap(async event => {
    const user = _.find(trackableUsers , [`peer['id']` , event.uid ]);

    if (containsValue(groupsToTrack, Number(event.id)) === true) {
      removeGroupFromTrackableGroups(event.id , user);
    } else if (
      containsValue(groupsToTrack, Number(event.id)) === false &&
      event.id !== "Hour" &&
      event.id !== "Minutes"
    ) {
      addGroupToTrackableGroups(event.id , user);
    }


    if (event.id === "Hour") {
      specifiedTime.hour = event.value;
      if (specifiedTime.min !== null && specifiedTime.hour !== null)
        scheduleCustomReminder(specifiedTime.hour, specifiedTime.min , user);
    } else if (event.id === "Minutes") {
      specifiedTime.min = event.value;
      if (specifiedTime.min !== null && specifiedTime.hour !== null)
        scheduleCustomReminder(specifiedTime.hour, specifiedTime.min , user );
    }
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
function removeGroupFromTrackableGroups(value , user) {
  groupIndexToRemove = _.findIndex(groupsToTrack, function(o) {
    return o.id === Number(value);
  });

  const messageToBot = {
    peer: user.peer,
    text: groupsToTrack[groupIndexToRemove].name + " tracking disabled"
  };
  sendTextToBot(bot, messageToBot);

  groupsToTrack.splice(groupIndexToRemove, 1);
  listBotGroupSubscriptions(bot, messageToBot);
}

function addGroupToTrackableGroups(value , user) {
  groupToInsert = _.find(addedToGroups, function(o) {
    return o.id === Number(value);
  });
  

  const messageToBot = {
    peer: user.peer,
    text: groupToInsert.name + " tracking enabled"
  };
  sendTextToBot(bot, messageToBot);

  groupsToTrack.push(groupToInsert);
  listBotGroupSubscriptions(bot, messageToBot);
}


function scheduleCustomReminder(hour, min , user) {
  const time = hour + ":" + min;
  const scheduledTime = moment(time, "HH:mm").format("HH:mm");
  const now = moment(Date.now()).format("HH:mm");
  const timeLeft = moment(scheduledTime, "HH:mm").diff(moment(now, "HH:mm"));
  
  if (timeLeft < 0) {
    sendTextMessage("Selected time has passed, try again" , user.peer);
    specifiedTime.hour = null;
    specifiedTime.min = null;
  } else {
    const successResponse = "Your mentions have been scheduled";
    sendTextMessage(successResponse , user.peer);

    setTimeout(function() {
      listMentions(bot , user);
    }, timeLeft);

    specifiedTime.hour = null;
    specifiedTime.min = null;
  }
}

/* -------

message handle functions

------ */
async function getCurrentUser(bot, peer) {
  const user = await bot.getUser(peer.id);
  const currentUser = new User( user.name , peer , user.nick );
  return currentUser;
}

async function addBotToTrackableGroups() {
  groupsToTrack.push.apply(groupsToTrack, addedToGroups);
}

async function addMentions(message) {
  const date = moment(message.date).format("MMMM Do YYYY, h:mm a");
  var group = "";

  const fetchedGroup = await bot
    .getGroup(message.peer.id)
    .then(res => (group = res));

  const mention = {
    group: group.title,
    text: message.content.text,
    time: date
  };
  mentions.push(mention);


  
}


function listMentions(bot , user) {

  let new_mentions = []
  mentions.map(mention => {
     const wordsArray = mention.text.split(' ');
     
       if(wordsArray.includes(user.nick)){
            new_mentions.push(mention);
       }
  });

  if(new_mentions.length !== 0){
      //send mentions to the user 
      let groups = [];
      new_mentions.map(mention => {
        if (!_.includes(groups, mention.group)) {
          groups.push(mention.group);
        }
      });

      groups.map(group => {
      var mentionsInGroup = _.filter(new_mentions, { group: group });
      var textToBot = `\n @${group} \n`;
      mentionsInGroup.map(mention => {
          textToBot += mention.time + ":" + mention.text + "\n";
      });

      var messageToSend = {
        peer: user.peer,
        text: textToBot
      };    

      sendTextToBot(bot, messageToSend);
      });

  }else{
    var messageToSend = {
      peer: user.peer,
      text: "You don't have any mentions"
    };    

    sendTextToBot(bot, messageToSend);


  }


}

function listBotGroupSubscriptions(bot, message) {
  _.forEach(addedToGroups, async function(group) {
    const buttonText = containsValue(groupsToTrack, group.id)
      ? "Stop"
      : "Start";
    const mid = bot
      .sendText(
        message.peer,
        group.name,
        MessageAttachment.reply(null),
        ActionGroup.create({
          actions: [
            Action.create({
              id: `${group.id}`,
              widget: Button.create({ label: buttonText })
            })
          ]
        })
      )
      .then(response => console.log(response))
      .catch(err => console.log(err));
  });
}

//general functions

function sendTextToBot(bot, message, actionGroup) {
  var actionGroups = actionGroup || null;
  bot
    .sendText(
      message.peer,
      message.text,
      MessageAttachment.reply(null),
      actionGroups
    )
    .then(response => console.log(response))
    .catch(err => console.log("err", err));
}

function containsValue(array, value) {
  valuePresent = false;
  array.map(object => {
    if (Number(object.id) === Number(value)) {
      valuePresent = true;
    }
  });
  return valuePresent;
}

function sendTextMessage(text, peer,  actions) {
  var messageToSend = messageformat(text , peer);
  var action = actions || null;
  var actionGroup = null;
  if (action !== null) {
    actionGroup = ActionGroup.create({
      actions: actionFormat(action)
    });
  }
  sendTextToBot(bot, messageToSend, actionGroup);
}

function actionFormat(actionOptions) {
  var actions = [];
  actionOptions.map(options => {
    if (options.type === "select") {
      const selectOptions = selectOptionFormat(options.options);
      var action = Action.create({
        id: options.id,
        widget: Select.create({
          label: options.label,
          options: selectOptions
        })
      });

      actions.push(action);
    } else if (options.type === "button") {
      var action = Action.create({
        id: options.id,
        widget: Button.create({ label: options.label })
      });

      actions.push(action);
    }
  });

  return actions;
}

function selectOptionFormat(options) {
  var selectOptions = [];
  options.map(option => {
    selectOptions.push(new SelectOption(option.label, option.value));
  });

  return selectOptions;
}

function messageformat(text , peer) {
  var message = { peer: peer, text: text };
  return message;
}

function User(name, peer, nick) {
  const nickname = `@${nick}`
  this.name = name;
  this.peer = peer;
  this.nick = nickname;
}
