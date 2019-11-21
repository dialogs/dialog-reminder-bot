const scheduleOptionsHr = [];
const scheduleOptionsMin = [];

let i, j;
for (i = 0; i < 24; i++) {
  scheduleOptionsHr.push(i.toString());
}
for (j = 0; j < 60; j++) {
  scheduleOptionsMin.push(j.toString());
}

function optionFormat(options) {
  let allOptions = [];
  options.map(option => {
    let format = {
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
