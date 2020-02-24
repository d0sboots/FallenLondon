// Named constants for setting object fields dynamically.
WATCHFUL = "watchful";
PERSUASIVE = "persuasive";

class State {
  constructor() {
    this.watchful = 0;
    this.persuasive = 0;
    this.pennies = 0;
    this.attar = 0;
    this.permission = 0;
    this.e_i = 0;
    this.num_trips = 0;
  }

  add(other) {
    this.watchful += other.watchful;
    this.persuasive += other.persuasive;
    this.pennies += other.pennies;
    this.attar += other.attar;
    this.permission += other.permission;
    this.e_i += other.e_i;
    // num_trips is handled separately
  }
}

class Bernoulli {
  constructor(probability, success, failure, acc) {
    this.probability = probability;
    this.success = success;
    this.failure = failure;
    this.accumulator = acc;
  }

  sample() {
    this.accumulator.add(
       (Math.random() < this.probability) ? this.success : this.failure);
  }
}

function challenge(value, base, field, success, failure) {
  value = Math.max(value, 0);
  prob = value * .6 / base;
  category = Math.min(10, Math.ceil(Math.floor(100 * prob) / 10));
  success[field] = [6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 1][category];
  failure[field] = [4, 4, 3, 3, 2, 1, 1, 1, 1, 1, 1][category];
  return prob;
}

class SerpentTend {
  constructor(acc) {
    this.accumulator = acc;
  }

  sample() {
    let acc = this.accumulator;
    acc.attar += acc.permission;
    acc.permission = 1;  // It will be decremented later.
  }
};

function chosen_near_distribution(knobs, acc) {
  let success = new State();
  let failure = new State();
  switch (knobs.near_choice) {
    case "explore":
      // This doesn't set permission; it's handled outside, in the main loop.
      success.attar = 2;
      failure.attar = -1;
      let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
      return [new Bernoulli(prob, success, failure, acc), 3];
    case "tend":
      return [new SerpentTend(acc), 5];
    default:
      throw new Error("No checkbox checked: " + knobs.near_choice);
  }
}

function chosen_far_distribution(knobs) {
  let success = new State();
  let failure = new State();
  let acc = new State();
  let prob, target_street;
  // None of these set permission; it's handled outside, in the main loop.
  switch (knobs.far_choice) {
    case "walk":
      success.attar = 2;
      failure.attar = -2;
      prob = challenge(knobs.watchful, 100, WATCHFUL, success, failure);
      target_street = 3;
      break;
    case "witness":
      success.attar = -3;
      success.pennies = 750;
      failure.attar = 2;
      failure.pennies = -250;
      prob = challenge(knobs.watchful - knobs.gear_diff, 115, WATCHFUL, success, failure);
      target_street = 5;
      break;
    case "surrender":
      success.attar = -3;
      success.pennies = 750;
      success.e_i = 3;
      failure.attar = 1;
      failure.pennies = 250;
      failure.e_i = 1;
      prob = challenge(knobs.persuasive, 100, PERSUASIVE, success, failure);
      target_street = 4;
      break;
    default:
      throw new Error("No checkbox checked: " + knobs.far_choice);
  }
  return [new Bernoulli(prob, success, failure, acc), target_street];
}

function gift_attar(state, rare_chance) {
  if (Math.random() < rare_chance) {
    state.pennies += Math.round(state.attar / 3) * 1250;
    state.attar = 0;
  } else {
    state.pennies += 1250;
    state.attar -= 3;
  }
}

function simulate_spy(knobs) {
  let num_trials = knobs.num_trials;
  let success = new State();
  let failure = new State();
  let acc = new State();
  success.pennies = 500;  // 2 EI
  success.permission = -1;
  failure.permission = -2;
  let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
  let distribution = new Bernoulli(prob, success, failure, acc);
  let actions = 0;
  for (let i = 0; i < num_trials; ++i) {
    actions += 2;  // Enter and exit
    acc.permission = 5;
    while (acc.permission > 0) {
      distribution.sample();
      actions++;
    }
  }
  acc.num_trips = num_trials;
  return [acc, actions];
}

function simulate_gift(knobs, attar_limit) {
  let rare_chance = knobs.rare_chance / 100;
  let num_trials = knobs.num_trials;
  // Setup far chosen action
  let [build_dist, far_target_street] = chosen_far_distribution(knobs);
  // Setup near chosen action
  let acc = build_dist.accumulator;
  let [explore_dist, near_target_street] = chosen_near_distribution(knobs, acc);

  let streets = 3;
  let converting = false;
  let actions = 0;
  for (let i = 0; i < num_trials; ++i) {
    actions += 2;  // Enter and exit
    // Handle entering (near or far.) We lose one Attar on entrance.
    let near = acc.attar <= 5;
    if (acc.attar > 0) {
      acc.attar--;
    }
    acc.permission = 5;
    while (acc.permission > 0) {
      if (near) {
        if (acc.attar >= 5) {
          // Enter far arbor
          near = false;
          streets = 3;
        } else if (streets < near_target_street) {
          streets++;  // Walk south
        } else if (streets > near_target_street) {
          streets--;  // Walk north
        } else {
          explore_dist.sample();
          if (acc.attar < 0) {
            acc.attar = 0;
          }
        }
      } else {
        if (acc.attar < 3) {
          // The city washes away
          near = true;
          streets = 3;
        } else if (converting) {
          if (streets < 5) {
            streets++;  // Walk south
          } else {
            gift_attar(acc, rare_chance);
            if (acc.attar < 3) {
              converting = false;
            }
          }
        } else {
          if (streets < far_target_street) {
            streets++;  // Walk south
          } else if (streets > far_target_street) {
            streets--;  // Walk north
          } else {
            build_dist.sample();
            if (acc.attar >= attar_limit) {
              converting = true;
            }
          }
        }
      }
      acc.permission--;
      actions++;
    }
  }
  acc.num_trips = num_trials;
  return [acc, actions];
}

onmessage = function(msg) {
  let [which, knobs, attar_limit] = msg.data;
  postMessage(self["simulate_" + which](knobs, attar_limit));
}
