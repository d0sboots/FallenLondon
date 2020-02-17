// We pass our state around in an array of integers. These constants are used
// to name the slots in the array.
WATCHFUL = 0
PERSUASIVE = 1
PENNIES = 2
ATTAR = 3
PERMISSION = 4
ACTIONS = 5
E_I = 6
NUM_TRIPS = 7

function add_span(results_node) {
  span = document.createElement("span");
  span.setAttribute("class", "stats");
  results_node.appendChild(span);
  return span;
}

function to_thousandths(num) {
  return Math.round(1000 * num) / 1000;
}

function display_results(results_node, arr) {
  let child;
  while (child = results_node.firstChild) {
    results_node.removeChild(child);
  }
  if (arr[ACTIONS] === 0) {
    let span = add_span(results_node);
    span.setAttribute("class", "stats error");
    span.textContent = "0 actions; is the number of trials 0?";
    return;
  }
  add_span(results_node).textContent =
    `Echoes/Action ${to_thousandths(arr[PENNIES]*.01/arr[ACTIONS])}`
  if (arr[WATCHFUL] !== 0) {
    add_span(results_node).textContent =
      `Watchful/Action ${to_thousandths(arr[WATCHFUL]/arr[ACTIONS])} cp`
  }
  if (arr[PERSUASIVE] !== 0) {
    add_span(results_node).textContent =
      `Persuasive/Action ${to_thousandths(arr[PERSUASIVE]/arr[ACTIONS])} cp`
  }
  add_span(results_node).textContent =
    `Actions/Trip ${to_thousandths(arr[ACTIONS]/arr[NUM_TRIPS])}`
}

class Bernoulli {
  constructor(probability, success, failure, acc) {
    this.probability = probability;
    this.success = success;
    this.failure = failure;
    this.accumulator = acc;
  }

  sample() {
    let func = (inc, idx) => {
      this.accumulator[idx] += inc;
    };
    if (Math.random() < this.probability) {
      this.success.forEach(func);
    } else {
      this.failure.forEach(func);
    }
  }
}

function init_params() {
  return [
    // Add one action and lose one permission to linger.
    [0, 0, 0, 0, -1, 1, 0, 0],
    [0, 0, 0, 0, -1, 1, 0, 0],
    new Array(8).fill(0),
  ];
}

function get_knobs() {
  return Object.fromEntries(["watchful", "persuasive", "rare_chance", "num_trials"]
      .map(key => [key, Number(document.getElementById(key).value)]));
}

function challenge(value, base, idx, success, failure) {
  prob = value * .6 / base;
  category = Math.min(10, Math.ceil(Math.floor(100 * prob) / 10));
  success[idx] = [6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 1][category];
  failure[idx] = [4, 4, 3, 3, 2, 1, 1, 1, 1, 1, 1][category];
  return prob;
}

function simulate_spy() {
  let results = document.getElementById("spy_results");
  let knobs = get_knobs();
  let num_trials = knobs.num_trials;
  let success, failure, acc;
  [success, failure, acc] = init_params();
  success[PENNIES] = 500;  // 2 EI
  failure[PERMISSION] = -2;
  let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
  let distribution = new Bernoulli(prob, success, failure, acc);
  for (let i = 0; i < num_trials; ++i) {
    acc[ACTIONS] += 2;  // Enter and exit
    acc[PERMISSION] = 5;
    while (acc[PERMISSION] > 0) {
      distribution.sample();
    }
  }
  acc[NUM_TRIPS] = num_trials;
  display_results(results, acc);
}
