// We pass our state around in an array of integers. These constants are used
// to name the slots in the array.
WATCHFUL = 0;
PERSUASIVE = 1;
PENNIES = 2;
ATTAR = 3;
PERMISSION = 4;
E_I = 5;
NUM_TRIPS = 6;

function add_span(results_node) {
  span = document.createElement("span");
  span.setAttribute("class", "stats");
  results_node.appendChild(span);
  return span;
}

function to_thousandths(num) {
  return Math.round(1000 * num) / 1000;
}

function display_results(results_node, arr, actions) {
  let child;
  while (child = results_node.firstChild) {
    results_node.removeChild(child);
  }
  if (actions === 0) {
    let span = add_span(results_node);
    span.setAttribute("class", "stats error");
    span.textContent = "0 actions; is the number of trials 0?";
    return;
  }
  add_span(results_node).textContent =
    `Echoes/Action ${to_thousandths(arr[PENNIES]*.01/actions)}`;
  if (arr[WATCHFUL] !== 0) {
    add_span(results_node).textContent =
      `Watchful/Action ${to_thousandths(arr[WATCHFUL]/actions)} cp`;
  }
  if (arr[PERSUASIVE] !== 0) {
    add_span(results_node).textContent =
      `Persuasive/Action ${to_thousandths(arr[PERSUASIVE]/actions)} cp`;
  }
  add_span(results_node).textContent =
    `Actions/Trip ${to_thousandths(actions/arr[NUM_TRIPS])}`;
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
    new Array(7).fill(0),
    new Array(7).fill(0),
    new Array(7).fill(0),
  ];
}

function get_knobs() {
  return Object.fromEntries(["watchful", "persuasive", "gear_diff", "rare_chance", "num_trials"]
      .map(key => [key, Number(document.getElementById(key).value)]));
}

function challenge(value, base, idx, success, failure) {
  prob = value * .6 / base;
  category = Math.min(10, Math.ceil(Math.floor(100 * prob) / 10));
  success[idx] = [6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 1][category];
  failure[idx] = [4, 4, 3, 3, 2, 1, 1, 1, 1, 1, 1][category];
  return prob;
}

function chosen_distribution(knobs, choices) {
  let [success, failure, acc] = init_params();
  let checked, prob, target_street;
  choices.forEach(elem => { if (elem.checked) { checked = elem.id.split("_")[1]; }});
  if (checked === "walk") {
    success[ATTAR] = 2;
    failure[ATTAR] = -2;
    prob = challenge(knobs.watchful, 100, WATCHFUL, success, failure);
    target_street = 3;
  } else if (checked === "witness") {
    success[ATTAR] = -3;
    success[PENNIES] = 750;
    failure[ATTAR] = 2;
    failure[PENNIES] = -250;
    prob = challenge(knobs.watchful - knobs.gear_diff, 115, WATCHFUL, success, failure);
    target_street = 5;
  } else if (checked === "surrender") {
    success[ATTAR] = -3;
    success[PENNIES] = 750;
    success[E_I] = 3;
    failure[ATTAR] = 1;
    failure[PENNIES] = 250;
    failure[E_I] = 1;
    prob = challenge(knobs.persuasive, 100, PERSUASIVE, success, failure);
    target_street = 4;
  } else {
    alert("Error! No checkbox checked.");
  }
  return [new Bernoulli(prob, success, failure, acc), target_street];
}

function gift_attar(arr, rare_chance) {
  if (Math.random() < rare_chance) {
    arr[PENNIES] += Math.round(arr[ATTAR] / 3) * 1250;
    arr[ATTAR] = 0;
  } else {
    arr[PENNIES] += 1250;
    arr[ATTAR] -= 1;
  }
}

function simulate_spy() {
  let results = document.getElementById("spy_results");
  let knobs = get_knobs();
  let num_trials = knobs.num_trials;
  let [success, failure, acc] = init_params();
  success[PENNIES] = 500;  // 2 EI
  success[PERMISSION] = -1;
  failure[PERMISSION] = -2;
  let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
  let distribution = new Bernoulli(prob, success, failure, acc);
  let actions = 0;
  for (let i = 0; i < num_trials; ++i) {
    actions += 2;  // Enter and exit
    acc[PERMISSION] = 5;
    while (acc[PERMISSION] > 0) {
      distribution.sample();
      actions++;
    }
  }
  acc[NUM_TRIPS] = num_trials;
  display_results(results, acc, actions);
}

function simulate_gift() {
  let results = document.getElementById("gift_results");
  let choices = document.getElementsByName("gift_radio");
  let knobs = get_knobs();
  let attar_limit = document.getElementById("attar_limit").value | 0;
  let rare_chance = knobs.rare_chance / 100;
  let num_trials = knobs.num_trials;
  // Setup chosen action
  let [build_dist, target_street] = chosen_distribution(knobs, choices);
  // Setup "explore the gatehouse market"
  let acc = build_dist.accumulator;
  let explore_dist;
  {
    let [success, failure] = init_params();
    success[ATTAR] = 2;
    failure[ATTAR] = -1;
    // These are handled outside the loop
    let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
    explore_dist = new Bernoulli(prob, success, failure, acc);
  }
  let streets = 3;
  let converting = false;
  let actions = 0;
  for (let i = 0; i < num_trials; ++i) {
    actions += 2;  // Enter and exit
    // Handle entering (near or far.) We lose one Attar on entrance.
    let near = acc[ATTAR] <= 5;
    if (acc[ATTAR] > 0) {
      acc[ATTAR]--;
    }
    acc[PERMISSION] = 5;
    while (acc[PERMISSION] > 0) {
      acc[PERMISSION]--;
      actions++;
      if (near) {
        if (acc[ATTAR] >= 5) {
          // Enter far arbor
          near = false;
          converting = false;
          streets = 3;
        } else if (streets > 3) {
          streets--;  // Walk north
        } else {  // Must be 3, we never go more north
          explore_dist.sample();
          if (acc[ATTAR] < 0) {
            acc[ATTAR] = 0;
          }
        }
      } else {
        if (acc[ATTAR] < 3) {
          // The city washes away
          near = true;
          streets = 3;
        } else if (converting) {
          if (streets < 5) {
            streets++;  // Walk south
          } else {
            gift_attar(acc, rare_chance);
          }
        } else {
          if (streets < target_street) {
            streets++;  // Walk south
          } else {
            build_dist.sample();
            if (acc[ATTAR] >= attar_limit) {
              converting = true;
            }
          }
        }
      }
    }
  }
  acc[NUM_TRIPS] = num_trials;
  console.log("Final state:", acc);
  display_results(results, acc, actions);
}
