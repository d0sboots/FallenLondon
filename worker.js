// Named constants for setting object fields dynamically.
WATCHFUL = "watchful";
PERSUASIVE = "persuasive";
DANGEROUS = "dangerous";

class State {
  constructor() {
    this.watchful = 0;
    this.persuasive = 0;
    this.dangerous = 0;
    this.pennies = 0;
    this.attar = 0;
    this.permission = 0;
    this.e_i = 0;
    this.num_trips = 0;
  }

  add(other) {
    this.watchful += other.watchful;
    this.persuasive += other.persuasive;
    // dangerous is summed separately in the only place that modifies it
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

class TempleLabour {
  constructor(acc, dangerous) {
    let success = new State();
    let failure = new State();
    this.probability = challenge(dangerous, 75, DANGEROUS, success, failure);
    this.dangerous_success = success.dangerous;
    this.dangerous_failure = failure.dangerous;
    this.accumulator = acc;
  }

  sample() {
    let acc = this.accumulator;
    if (Math.random() < this.probability) {
      acc.dangerous += this.dangerous_success;
      acc.attar += acc.permission;
    } else {
      acc.dangerous += this.dangerous_failure;
      acc.pennies += acc.permission * 250;  // 1x Sworn Statement
    }
    acc.permission = 1;  // It will be decremented later.
  }
};

function setup_explore(knobs, acc) {
  let success = new State();
  let failure = new State();
  // This doesn't set permission; it's handled outside, in the main loop.
  success.attar = 2;
  failure.attar = -1;
  let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
  return new Bernoulli(prob, success, failure, acc);
}

function chosen_near_distribution(knobs, acc) {
  switch (knobs.near_choice) {
    case "explore":
      return [setup_explore(knobs, acc), 3];
    case "tend":
      return [new SerpentTend(acc), 5];
    case "labour":
      return [new TempleLabour(acc, knobs.dangerous), 1];
    default:
      throw new Error("No checkbox checked: " + knobs.near_choice);
  }
}

class SerpentShepherd {
  constructor(acc) {
    this.accumulator = acc;
  }

  sample() {
    let acc = this.accumulator;
    acc.pennies += acc.permission * 250;  // 1x Presbyterate Passphrase
    acc.permission = 1;  // It will be decremented later.
  }
};

function setup_walk(knobs, acc) {
  let success = new State();
  let failure = new State();
  success.attar = 2;
  failure.attar = -2;
  let prob = challenge(knobs.watchful, 100, WATCHFUL, success, failure);
  return new Bernoulli(prob, success, failure, acc);
}

function setup_surrender(knobs, acc) {
  let success = new State();
  let failure = new State();
  success.attar = -3;
  success.pennies = 750;
  success.e_i = 3;
  failure.attar = 1;
  failure.pennies = 250;
  failure.e_i = 1;
  let prob = challenge(knobs.persuasive, 100, PERSUASIVE, success, failure);
  return new Bernoulli(prob, success, failure, acc);
}

function setup_witness(knobs, acc) {
  let success = new State();
  let failure = new State();
  success.attar = -3;
  success.pennies = 750;
  failure.attar = 2;
  failure.pennies = -250;
  let prob = challenge(knobs.watchful - knobs.gear_diff, 115, WATCHFUL, success, failure);
  return new Bernoulli(prob, success, failure, acc);
}

function chosen_far_distribution(knobs) {
  let acc = new State();
  // None of these set permission; it's handled outside, in the main loop.
  switch (knobs.far_choice) {
    case "walk":
      return [setup_walk(knobs, acc), 3]
    case "witness":
      return [setup_witness(knobs, acc), 5];
    case "surrender":
      return [setup_surrender(knobs, acc), 4]
    case "shepherd":
      return [new SerpentShepherd(acc), 1];
    default:
      throw new Error("No checkbox checked: " + knobs.far_choice);
  }
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

function setup_spy(knobs, acc) {
  let success = new State();
  let failure = new State();
  success.pennies = 500;  // 2 EI
  success.e_i = 2;
  success.permission = -1;
  failure.permission = -2;
  let prob = challenge(knobs.watchful, 75, WATCHFUL, success, failure);
  return new Bernoulli(prob, success, failure, acc);
}

function simulate_spy(knobs) {
  let num_trials = knobs.num_trials;
  let distribution = setup_spy(knobs, new State());
  let acc = distribution.accumulator;
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

function simulate_gift(knobs) {
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
          actions++;
          continue;  // *Doesn't* cost permission
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
            if (acc.attar >= knobs.attar_limit) {
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

function setup_try_shortcut(knobs, acc) {
  let success = new State();
  let failure = new State();
  let shortcut_prob = challenge(knobs.watchful, 79, WATCHFUL, success, failure);
  let shortcut_win = success[WATCHFUL];
  let shortcut_lose = failure[WATCHFUL];

  return function() {
    if (Math.random() < shortcut_prob) {
      acc.watchful += shortcut_win;
      return 2;
    } else {
      acc.watchful += shortcut_lose;
      return Math.floor(Math.random() * 5) + 1;
    }
  }
}

function simulate_loop(knobs) {
  let num_trials = knobs.num_trials;

  let spy_dist = setup_spy(knobs, new State());
  // The permission loss is built-in to the loop, adjust.
  spy_dist.success.permission += 1;
  spy_dist.failure.permission += 1;
  let acc = spy_dist.accumulator;

  let streets = 2;  // Start/end in North Arbor
  let try_shortcut = setup_try_shortcut(knobs, acc);

  let actions = 0;
  for (let i = 0; i < num_trials; ++i) {
    actions += 2;  // Enter and exit
    acc.permission = 5;
    let investigating = true;
    while (acc.permission > 0) {
      if (investigating) {
        if (streets < 4) {
          streets++;  // Walk south
        } else {
          // This is guaranteed, so we can do it all at once
          actions += knobs.batch_size;
          acc.permission += 3 * knobs.batch_size;
          acc.e_i -= 3 * knobs.batch_size;
          acc.pennies -= 750 * knobs.batch_size;
          investigating = false;
          continue;  // Avoid increments at end
        }
      } else {
        if (streets == 4) {
          // Take a short-cut north
          streets = try_shortcut();
        } else if (streets > 2) {
          streets--;  // Walk north
        } else if (streets < 2) {
          streets++;  // Walk south
        } else {
          spy_dist.sample();
        }
      }
      acc.permission--;
      actions++;
    }
  }
  acc.num_trips = num_trials;
  return [acc, actions];
}

function simulate_grind(knobs) {
  let num_trials = knobs.num_trials;
  let rare_chance = knobs.rare_chance / 100;

  let spy_dist = setup_spy(knobs, new State());
  // The permission loss is built-in to the loop, adjust.
  spy_dist.success.permission += 1;
  spy_dist.failure.permission += 1;
  let acc = spy_dist.accumulator;

  let explore_dist = setup_explore(knobs, acc);
  let walk_dist = setup_walk(knobs, acc);
  let surrender_dist = setup_surrender(knobs, acc);
  let try_shortcut = setup_try_shortcut(knobs, acc);

  let streets = 2;  // Start/end in North Arbor

  let actions = 0;
  acc.e_i = knobs.batch_size * 3;
  for (let i = 0; i < num_trials; ++i) {
    actions += 2;  // Enter and exit
    // Handle entering (near or far.) We lose one Attar on entrance.
    let near = acc.attar <= 5;
    if (acc.attar > 0) {
      acc.attar--;
    }
    acc.permission = 5;
    let stage = 0;
    while (acc.permission > 0) {
      if (near && acc.attar >= 5) {
        // Enter far arbor
        near = false;
        streets = 3;
        actions++;
        continue;  // *Doesn't* cost permission
      }
      if (!near && acc.attar < 3) {
        // The city washes away
        near = true;
        acc.permission--;
        actions++;
        continue;
      }
      switch (stage) {
        case 0:  // Building permission
          if (!near) {  // This shouldn't happen. Advance stage.
            stage = 2;
          } else {
            if (streets > 4) {
              streets--;  // Walk north
            } else if (streets < 4) {
              streets++;  // Walk south
            } else {
              // This is guaranteed, so we can do it all at once
              let rounds = (acc.e_i / 3) | 0;
              actions += rounds;
              acc.permission += 3 * rounds;
              acc.e_i -= 3 * rounds;
              acc.pennies -= 750 * rounds;
              stage = 1;
              continue;  // Avoid increments at end
            }
          }
          break;
        case 1:  // Build Attar in Near-Arbor
          if (!near) {  // Normal method of advancing.
            stage = 2;
            continue;
          }
          if (streets > 3) {
            streets--;  // Walk north
          } else if (streets < 3) {
            streets++;  // Walk south
          } else {
            explore_dist.sample();
            if (acc.attar < 0) {
              acc.attar = 0;
            }
          }
          break;
        case 2:  // Build Attar in Far-Arbor
          if (near) {  // Shouldn't happen. Advance stage.
            stage = 5;
            continue;
          }
          if (acc.permission <= knobs.walk_threshold) {
            stage = 3;
            continue;
          }
          if (streets > 3) {
            streets--;  // Walk north
          } else if (streets < 3) {
            streets++;  // Walk south
          } else {
            walk_dist.sample();
          }
          break;
        case 3:  // Surrender Attar
          if (near) {  // Shouldn't happen. Advance stage.
            stage = 5;
            continue;
          }
          if (acc.permission <= knobs.surrender_threshold) {
            stage = 4;
            continue;
          }
          if (streets > 4) {
            streets--;  // Walk north
          } else if (streets < 4) {
            streets++;  // Walk south
          } else {
            surrender_dist.sample();
          }
          break;
        case 4:  // Gift Attar
          if (near) {  // Normal method of advancing.
            stage = 5;
            continue;
          }
          if (streets < 5) {
            streets++;  // Walk south
          } else {
            gift_attar(acc, rare_chance);
          }
          break;
        case 5:  // Buy back EIs
          if (!near) {  // Shouldn't happen. Decrement stage.
            stage = 4;
            continue;
          }
          if (streets == 4) {
            // Take a short-cut north
            streets = try_shortcut();
          } else if (streets > 2) {
            streets--;  // Walk north
          } else if (streets < 2) {
            streets++;  // Walk south
          } else {
            spy_dist.sample();
          }
          break;
      }
      acc.permission--;
      actions++;
    }
  }
  acc.num_trips = num_trials;
  acc.e_i -= knobs.batch_size * 3;  // Discount what we started with.
  return [acc, actions];
}

onmessage = function(msg) {
  let [which, knobs] = msg.data;
  postMessage(self["simulate_" + which](knobs));
}
