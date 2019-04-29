const scheduleOptionsHr = [];
const scheduleOptionsMin = [];

var i, j;
for (i = 0; i < 24; i++) {
  scheduleOptionsHr.push(i.toString());
}
for (j = 0; j < 60; j++) {
  scheduleOptionsMin.push(j.toString());
}

function optionFormat(options) {
  var allOptions = [];
  options.map(option => {
    var format = {
      label: option,
      value: option
    };
    allOptions.push(format);
  });

  return allOptions;
}

exports.time = {
  hours: optionFormat(scheduleOptionsHr),
  minutes: optionFormat(scheduleOptionsMin)
};
