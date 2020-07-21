function add_span(results_node) {
  span = document.createElement("span");
  span.setAttribute("class", "stats");
  results_node.appendChild(span);
  return span;
}

function to_thousandths(num) {
  return Math.round(1000 * num) / 1000;
}

function display_results(results_node, state, actions) {
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
    `Echoes/Action: ${to_thousandths(state.pennies*.01/actions)}`;
  add_span(results_node).textContent =
    `Echoes/Trip: ${to_thousandths(state.pennies*.01/state.num_trips)}`;
  if (state.watchful !== 0) {
    add_span(results_node).textContent =
      `Watchful/Action: ${to_thousandths(state.watchful/actions)} cp`;
  }
  if (state.persuasive !== 0) {
    add_span(results_node).textContent =
      `Persuasive/Action: ${to_thousandths(state.persuasive/actions)} cp`;
  }
  if (state.dangerous !== 0) {
    add_span(results_node).textContent =
      `Dangerous/Action: ${to_thousandths(state.dangerous/actions)} cp`;
  }
  let e_i_per_action = to_thousandths(state.e_i/actions);
  if (e_i_per_action !== 0) {
    add_span(results_node).textContent =
      `EIs/Action: ${e_i_per_action}`;
  }
  add_span(results_node).textContent =
    `Actions/Trip: ${to_thousandths(actions/state.num_trips)}`;
}

function get_checked(choices) {
  let checked = null;
  choices.forEach(elem => { if (elem.checked) { checked = elem.id.split("_")[1]; }});
  return checked;
}

function get_knobs() {
  knobs = Object.fromEntries(["watchful", "persuasive", "dangerous", "gear_diff", "num_trials", "attar_limit"]
      .map(key => [key, document.getElementById(key).value | 0]));
  knobs.rare_chance = Number(document.getElementById("rare_chance").value);
  knobs.near_choice = get_checked(document.getElementsByName("near_radio"));
  knobs.far_choice = get_checked(document.getElementsByName("far_radio"));
  return knobs;
}

function simulate(which) {
  let results = document.getElementById(which + "_results");
  let button = document.getElementById(which + "_button");
  let knobs = get_knobs();

  let original_button_value = button.value;
  let original_button_onclick = button.onclick;
  button.classList.add("processing");
  button.value = "Processing";
  button.onclick = null;

  let worker = new Worker("worker.js");
  worker.postMessage([which, knobs]);
  worker.onmessage = msg => {
    let [result_state, actions] = msg.data;

    console.log("Final state:", result_state);
    button.classList.remove("processing");
    button.value = original_button_value;
    button.onclick = original_button_onclick;
    display_results(results, result_state, actions);
    worker.terminate();
  };
  worker.onerror = evt => { window.alert("Worker threw error: " + evt.message); }
}
