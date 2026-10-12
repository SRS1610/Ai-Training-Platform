# Simulation engine

Interactive simulations are Praxis's main differentiator. A learner works in a realistic environment (a
ticket queue, a terminal, a chat with a customer, a SIEM, a restaurant floor). Their actions change the state
of the scenario and have consequences, and a deterministic engine scores what they did.

This document covers:

* the definition format
* the condition language
* engine semantics
* scoring
* the builder graph format
* the HTTP API
* the guard rails around AI

It describes what is implemented in `packages/simulation-engine` (package `simulation_engine`) and
`apps/api/app/modules/simulations`.

## 1. Principles

* **Simulations are data, not code.** A scenario is a versioned JSON *definition* that Pydantic validates
  (`simulation_engine.schema`). No scenario-specific Python exists.
* **The engine is deterministic.** `step(definition, state, action, input)` is a pure reducer. It reads no
  wall clock and uses no randomness after `start(definition, seed)`. If you replay the same inputs with the same seed, you
  get byte-identical states. Every action is persisted, so sessions can be replayed and audited.
* **The engine owns correctness.** Scores, phase changes and consequences come only from the definition.
  The AI layer may *phrase* character replies and the debrief narrative. It never decides outcomes
  (ADR-005).
* **Secrets stay server side.** The full engine state lives in `simulation_sessions.state`. Learners only
  ever receive projections (`learner_view`, `public_outcome`) that strip hidden variables, unrevealed facts,
  action consequences and grading.
* **The engine is industry-agnostic.** The three bundled templates (IT helpdesk, SOC phishing, restaurant
  food safety) use the same framework.

## 2. Package layout and public API

```
packages/simulation-engine/
  simulation_engine/
    schema.py       Pydantic v2 definition models (schema_version "1.0")
    conditions.py   safe JSON-logic condition DSL (evaluate, truthy, check_condition)
    intents.py      free-text normalisation, synonyms, stemming, fuzzy intent matching
    engine.py       start, step, resolve_input, learner_view, public_outcome, available_actions, sensitive_values
    scoring.py      compute_scores, finish, band_for, feedback builder
    validation.py   validate (errors/warnings), repair (sanitise machine-generated drafts)
    graph.py        to_graph / from_graph / merge_positions (React Flow builder)
    templates/      it_helpdesk_network.json, phishing_email_investigation.json,
                    restaurant_food_safety_complaint.json (+ list_templates / load_template)
  tests/            141 unit tests, ~98% line coverage
```

The package has no web or database dependencies. Its only dependency is `pydantic`. Install it with
`pip install -e packages/simulation-engine`.

```python
from simulation_engine import load_template, validate, start, step, finish, learner_view, public_outcome

d = load_template("it-helpdesk-network")
assert validate(d).valid
state = start(d, seed=42)
r = step(d, state, None, {"text": "ipconfig /all"}, tool="terminal")      # typed command
r = step(d, r.state, None, {"text": "When did it start?"}, character="priya")  # chat
r = step(d, r.state, "record_diagnosis", {"choice": "stale_static_dns"})   # explicit action
result = finish(d, r.state)   # scores, band, passed, feedback
```

`step` raises `UnknownAction`, `InvalidInput` (for example a bad choice id) or `SimulationEnded`. All three are
subclasses of `EngineError`.

## 3. Definition reference

The top-level keys are listed below. Unknown keys are rejected everywhere (`extra="forbid"`) so that typos
surface during authoring.

| Key | Type | Purpose |
|---|---|---|
| `schema_version` | `"1.0"` | Format version |
| `key` | str? | Template key (informational) |
| `meta` | Meta | Learner-facing description |
| `environment.panels` | Panel[] | Screens shown in the workspace |
| `tools` | Tool[] | What the learner can use. Each tool is bound to a panel |
| `characters` | Character[] | People the learner talks to, and what they know |
| `intents` | Intent[] | Free-text intents recognised in chat or search boxes |
| `synonyms` | {canonical: [variants]} | Extra vocabulary for intent matching |
| `phases`, `initial_phase` | Phase[], str | Configurable state machine (default `INITIAL → INVESTIGATION → DIAGNOSIS → REMEDIATION → VALIDATION → RESOLUTION`) |
| `variables` | {name: VariableSpec} | Scenario state, including secret ground truth |
| `variations` | Variation[] | Seeded scenario variants |
| `opening_messages` | Message[] | Transcript at start |
| `actions` | Action[] | Everything the learner can do |
| `events` | Event[] | Timed or conditional happenings |
| `scoring` | Scoring | Weighted dimensions, bands, efficiency and process rules |
| `completion` | Completion | Success, failure and limits |
| `feedback_rules` | FeedbackRule[] | Conditions that produce feedback items |
| `settings` | Settings | Unknown-input policy, repeat policy, feedback visibility, AI voice, timeout |

### 3.1 Meta

`title` is required. The other fields are `description`, `industry`, `environment_type`, `difficulty`
(beginner|intermediate|advanced|expert), `estimated_minutes`, `briefing`, `learner_role`, `objectives[]` and
`tags[]`. Learners see all of them.

### 3.2 Panels and tools

```json
{"id": "system_info", "type": "system_info", "title": "System Information",
 "visible_when": {"action_taken": "open_system_info"},
 "data": {"dns_assignment": "Manual (static)", "dns_servers": "{{stale_dns}}"},
 "variants": [{"when": {"==": [{"var": "dns_mode"}, "dhcp"]},
               "data": {"dns_assignment": "Automatic (DHCP)", "dns_servers": "10.20.1.10, 10.20.1.11"}}]}
```

* `type` is a rendering hint for the web app. The known types are `ticket`, `chat`, `terminal`,
  `system_info`, `knowledge_base`, `email_inbox`, `email_viewer`, `siem_alerts`, `url_sandbox`, `crm_record`,
  `patient_chart`, `dashboard`, `document`, `log_viewer`, `checklist`, `admin_console`, `case_file` and
  `custom`. Any other type is allowed, with a validator warning, and is rendered generically.
* `data` is free-form JSON. Strings support `{{variable}}` interpolation.
* `variants` are merged over `data` in order while their `when` holds, which lets panels change with state.
* `visible_when` hides the panel until a condition holds.

A tool has the fields `id`, `name`, `panel`, `description`, `icon`, `prompt` (a terminal prompt) and
`visible_when`. It also has `unknown_input_output`, the output for unrecognised commands. That output may
use `{{$input.text}}`, for example a PowerShell "is not recognized" error.

### 3.3 Characters, facts and intents

```json
{"id": "priya", "name": "Priya Shah", "role": "Finance Analyst", "persona": "...", "tone": "...",
 "patience_var": "customer_patience", "patience_decay_per_minute": 0.8,
 "fallback_reply": "Sorry, I'm not sure what you mean...",
 "facts": [{"id": "f_started", "text": "It started yesterday after the VPN update."},
           {"id": "f_password", "intents": ["password"], "text": "My password's fine..."}]}
```

A fact becomes known to the learner in one of three ways. It is shown in the "facts known" list and added
to the context the AI is allowed to use.

1. An action effect `{"reveal": ["f_started"]}`. This is the usual way: an `ask` action whose intents
   matched.
2. The learner's chat message matches one of the fact's `intents` and its `when` holds. The engine then
   replies with the fact text. This kind of turn is unscored and costs 1 simulated minute.
3. `auto_reveal: true` and `when` holds after any step.

Intents (`{"id", "patterns": [...], "examples": [...]}`) are matched deterministically:

* **Normalisation.** Text is lower-cased, apostrophes are dropped, `wi-fi` becomes `wifi`, and stopwords are
  removed. Question words such as *when*, *what* and *how* are kept for patterns.
* **Synonyms.** Built-in groups (for example `began` and `begin` map to `start`, `laptop` maps to `computer`,
  `install` and `update` map to `change`) are combined with the definition's `synonyms`.
* **Stemming.** A light stemmer is applied (`started` → `start`).
* **Patterns.** Every word of a pattern must be present. Small typos are tolerated (`difflib` ratio ≥ 0.84) and
  so are prefixes of 5 or more characters. The score is the number of pattern words, plus 0.5 if the pattern
  appears as an exact phrase.
* **Examples.** Whole sentences match when their word overlap (Jaccard) is at least 0.5.
* **Winner.** The highest score wins. Ties go to an action that is currently available, then to definition
  order. Actions beat facts when scores are equal.

### 3.4 Phases

```json
{"id": "INVESTIGATION", "name": "Investigation", "transitions": ["DIAGNOSIS", "REMEDIATION", "ESCALATED"],
 "auto_advance": [{"to": "DIAGNOSIS", "when": {"and": [{"var": "ev_dns_fail"}, {"var": "ev_dns_config"}]}}],
 "terminal": false}
```

* `transitions` lists the allowed next phases. The builder draws them as edges.
* `auto_advance` rules move the session after every step, as long as their `to` is in `transitions` (the
  validator enforces this). They are evaluated in order and chain until the state is stable.
* An effect `{"transition": "X"}` is a *forced* transition, such as an escalation. It is applied regardless
  of `transitions`.
* `terminal: true` ends the run when it is reached, but only if `completion.success` is not set.
* `phase_history` records every visit (`phase`, `seq`, `minutes`) for process scoring and analytics.

### 3.5 Variables and variations

```json
"root_cause":  {"type": "str", "initial": "stale_static_dns_after_vpn_update", "visibility": "secret"},
"ticket_status": {"type": "str", "initial": "Assigned", "visibility": "public", "label": "Ticket status"},
"customer_patience": {"type": "float", "initial": 100, "visibility": "public", "min": 0, "max": 100},
"stale_dns": {"type": "str", "initial": "10.0.0.53", "pool": ["10.0.0.53", "10.0.0.54"]}
```

* `visibility` controls what the learner can see.
  * `public` variables are sent in `learner_view.variables`. Use them for meters and statuses.
  * `internal` is the default. These variables are never sent, but authors may interpolate them into
    outputs and panels (for example the DNS server shown by `ipconfig`).
  * `secret` variables hold ground truth. They are never sent, and the validator fails the definition if one
    is interpolated into any learner-visible text.
* `min` and `max` clamp numeric changes.
* `pool` picks one value per session from the seed. `variations` (weighted `{id, set: {...}}`) pick a whole
  variant from the seed, after pools are applied. Both are deterministic for a given seed.

### 3.6 Actions

```json
{"id": "nslookup", "tool": "terminal", "label": "nslookup a host name", "kind": "command",
 "input": {"type": "command", "patterns": ["nslookup\\s+(?P<host>[a-z0-9.-]+)"]},
 "time_cost": 0.5, "preconditions": null, "phases": [],
 "branches": [
   {"id": "dns_broken", "when": {"==": [{"var": "dns_mode"}, "static"]}, "classification": "correct",
    "effects": [{"set": {"ev_dns_fail": true}}],
    "score": {"technical_accuracy": 4, "troubleshooting_process": 3},
    "outputs": [{"text": "DNS request timed out...\nAddress:  {{stale_dns}}", "format": "terminal"}]},
   {"id": "validated", "when": true, "classification": "correct", "effects": [{"set": {"validated": true}}],
    "score": {"technical_accuracy": 4, "troubleshooting_process": 3},
    "outputs": [{"text": "Name: intranet.corp.local\nAddress: 10.20.5.25", "format": "terminal"}]}]}
```

| Field | Meaning |
|---|---|
| `kind` | `ask`, `command`, `inspect`, `select`, `submit`, `document` or `escalate`. This is the semantic category, used for UI grouping and analytics |
| `tool`, `character` | Where the action lives. `ask` actions need a `character` |
| `input.type` | `none` for buttons. `free_text` for chat, matched by `input.intents`, or documents (`min_length`). `command` for typed commands, matched by `input.patterns`, which are case-insensitive full-match regexes on whitespace-normalised text. Groups become `$input.args` and named groups become `$input.named.*`. `choice` uses `input.choices[{id,label}]`, and the choice is available as `$input.choice` |
| `preconditions`, `phases` | When the action is available. If it isn't, the step is rejected with `precondition_message`, and for `ask` actions the character says that message |
| `effects`, `score`, `classification`, `feedback`, `outputs`, `messages`, `time_cost` | The default outcome |
| `branches[]` | Alternative outcomes. The first one whose `when` holds is used. `when` is evaluated *before* effects |
| `repeat` | Repeat policy that overrides `settings.repeat` |
| `listed` | Whether the action appears as a button or menu item. Defaults to false for `command` and `ask`, which learners have to type, and true otherwise |
| `hint` | Shown in practice mode only |

**How branches combine with the action.** The action's own `effects` and `messages` always apply first as
shared consequences, followed by the branch's. The branch's `score`, `classification`, `feedback`, `outputs`
and `time_cost` replace the action's values when the branch sets them. `null` means the branch inherits
the action's value.

**Outputs and messages.** `outputs` are *first match wins*: list conditional outputs first and a
fallback output last. `messages` are *every match*. Both are evaluated *after* effects, so they can reflect
the new state.

**Effects.** One effect object may combine several keys, which apply in this order: `set` → `inc` → `reveal`
→ `add_problem` → `remove_problem` → `transition` → `trigger_event` → `complete`.

* `set` values that are dicts or lists are evaluated as conditions, for example
  `{"set": {"guess": {"var": "$input.choice"}}}`.
* String values of `set` are interpolated, for example `"{{$input.text}}"`.
* `complete` takes `success`, `failure` or `escalated` and ends the run.
* Problems (`{id, text, severity}`) are learner-visible issues, such as "Customer escalated to manager".

**Classification** (`correct`, `neutral`, `incorrect` or `critical`) feeds feedback and analytics. Any
`critical` classification marks a critical failure.

### 3.7 Events

```json
{"id": "customer_escalates", "title": "Customer escalates", "classification": "incorrect",
 "trigger": {"type": "condition", "condition": {"<=": [{"var": "customer_patience"}, 0]}},
 "effects": [{"add_problem": {"id": "customer_escalation", "severity": "high", "text": "..."}}],
 "score": {"communication": -6}, "notify": "Priya escalated the ticket.",
 "messages": [{"character": "priya", "text": "I'm escalating this to your manager."}], "once": true}
```

There are three trigger types:

* `time`: `at_minutes`, with an optional `condition`.
* `condition`.
* `after_action`: `action`, with an optional `condition`.

`once` defaults to true. Repeatable events need `max_fires` to bound them. An event can also be fired
directly by an effect (`trigger_event`).

When an event fires, the engine:

1. applies its effects and score
2. sends its messages
3. adds `notify` to the transcript as a system notice
4. may consume `time_cost`
5. if the event is `critical`, adds it to `criticals`

### 3.8 Scoring

```json
"scoring": {
  "dimensions": [{"id": "technical_accuracy", "name": "Technical accuracy", "weight": 35, "max_points": 40}, ...],
  "efficiency": {"dimension": "efficiency", "target_minutes": 30, "max_minutes": 80, "require_success": true},
  "process": {"dimension": "troubleshooting_process", "required_order": ["INITIAL", ...], "skip_penalty": 4},
  "bands": [{"name": "Expert", "min": 95}, {"name": "Advanced", "min": 85}, {"name": "Competent", "min": 70},
            {"name": "Needs Improvement", "min": 50}, {"name": "Fail", "min": 0}],
  "pass_mark": 70, "critical_cap": 49, "require_completion": true}
```

The engine computes the score as follows.

1. **Raw points.** For each dimension, `raw = (baseline == "full" ? max_points : 0) + Σ score deltas` from
   actions, events, unknown-input penalties and repeat penalties.
2. **Efficiency.** The efficiency dimension gets `max_points × factor + deltas`.
   * The factor is 1 when `minutes ≤ target_minutes` and falls linearly to 0 at `max_minutes`.
   * With `require_success`, the factor is 0 unless the run ended in `success`. Escalating at minute 2 is not
     "efficient".
3. **Process adherence.** The process dimension loses `skip_penalty` for each required phase that was
   skipped before the furthest required phase reached. For example, jumping from INVESTIGATION to
   REMEDIATION skips DIAGNOSIS.
4. **Clamping.** Raw points are clamped to `[0, max_points]`. The dimension score is
   `raw / max_points × weight`, and the total is the sum, from 0 to 100.
5. **Critical cap.** Any critical action or event caps the total at `critical_cap`.
6. **Band.** The band is the first band with `total ≥ min`.
7. **Pass.** `passed = total ≥ pass_mark`, with no critical failure, and the run completed successfully if
   `require_completion` is set.

Weights must sum to 100. Calibrate `max_points` to about 80–90% of the points available on the optimal path.
That lets a strong run that skips one nicety still reach Expert. The validator warns when a dimension can't
reach its max.

### 3.9 Completion, feedback rules and settings

* `completion` has these fields:
  * `success` and `failure` are conditions.
  * `max_sim_minutes` ends the run with reason `timeout`.
  * `max_actions` ends it with reason `action_limit`.
  * Effects with `complete` take precedence over all of these.
* `feedback_rules` are evaluated by `finish`. Each is `{id, when, type: strength|improvement|missed_step|tip,
  text, priority}`.
* The engine adds further feedback automatically:
  * `critical_actions` and `incorrect_actions` (label + feedback)
  * process-skip improvements
  * a "focus area" tip for the weakest dimension when it is below 60%
  * a `timeline` of every step and event
  * a `summary` sentence
* `settings` contains:
  * `unknown_input`: `{penalty: {"communication": -1}, max_penalised: 5, time_cost: 0.5, reply}`. Only chat
    messages are penalised. Unknown terminal commands are realistic noise and print the tool's
    `unknown_input_output`.
  * `repeat`: `{mode: diminish|allow|penalize|block, free_repeats, penalty, message}`.
  * `show_feedback` and `show_feedback_when_graded`.
  * `ai_character_voice`.
  * `session_timeout_minutes`: wall-clock inactivity, enforced by the API.

## 4. Condition DSL

A condition is a literal, a list (each item is evaluated) or a single-key object `{"op": args}`. No `eval` or
`exec` is used: there is a closed operator table, a depth limit of 32 and a limit of 2,000 nodes. Unknown
operators raise `ConditionError`, and the validator reports them.

| Operator | Example | Notes |
|---|---|---|
| `and`, `or` | `{"and": [c1, c2]}` | Short-circuit. Returns the deciding value |
| `not`, `!` | `{"!": {"var": "fixed"}}` | |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | `{">=": [{"var": "$minutes"}, 30]}` | Type mismatches are false, never an error |
| `in` | `{"in": [{"var": "$input.named.server"}, ["10.20.1.10", "10.20.1.11"]]}` | Works on lists and substrings |
| `+`, `-` | `{"+": [{"var": "a"}, 1]}` | Booleans count as 0 or 1 |
| `var` | `{"var": "nested.key"}`, `{"var": ["name", default]}` | See the special variables below |
| `has_fact` | `{"has_fact": "f_error"}` | |
| `phase_is` | `{"phase_is": ["DIAGNOSIS", "REMEDIATION"]}` | |
| `visited_phase` | `{"visited_phase": "VALIDATION"}` | |
| `action_taken` | `{"action_taken": "ping_ip"}`, `{"action_taken": ["ping_ip", 2]}` | Optional minimum count |
| `count` | `{"count": "ping_ip"}`, `{"count": {"var": "list"}}` | Action count, or list length |
| `event_fired`, `has_problem` | `{"event_fired": "customer_escalates"}` | |
| `contains` | `{"contains": [{"var": "$input.text"}, "dns"]}` | Case-insensitive for strings |
| `count_keywords` | `{"count_keywords": [{"var": "$input.text"}, ["dns", ["dhcp", "automatic"]]]}` | Counts distinct keywords. A nested list is a synonym group that counts once |

The special variables are:

* `$input.text`, `$input.choice`, `$input.args.N` and `$input.named.<group>`
* `$minutes`, `$phase`, `$actions_count`, `$problems_count` and `$unknown_inputs`

The same names work in `{{…}}` text interpolation. Booleans render as yes or no, and lists are joined with
commas.

## 5. Engine semantics

### State

`start` returns a JSON-serialisable dict with these keys:

* `seed`, `variation`, `phase`, `phase_history`
* `variables`, `revealed_facts`, `problems`
* `action_counts`, `outcome_counts`
* `history[]`: steps and events, with input, branch, classification, score deltas and minutes
* `score{dim: Σdeltas}`, `minutes`, `fired_events`
* `transcript[]`: messages, commands, outputs and notices
* `seq`, `unknown_inputs`, `criticals`
* `ended`, `end_reason`

### Step algorithm

`step(definition, state, action_id=None, input=None, *, tool=None, character=None)`:

1. If the state has ended, raise `SimulationEnded`.
2. If there is no `action_id`, resolve the free text.
   * With a `character`, chat intents are matched against that character's `ask` actions and then against
     the character's facts.
   * With a `tool`, command regexes are tried in definition order, available actions first. Free-text
     actions bound to the tool are tried next.
   * If nothing matches, the step becomes an *unknown* step. A chat gets the character's fallback reply plus
     the unknown-input penalty. A command gets the tool's "not recognized" output.
3. Check availability (phases, preconditions, tool visibility, block-repeat) and validate the input. A choice
   must be a valid choice id, and text must meet `min_length`. Rejections return
   `outcome.accepted = false` with the state **unchanged** and no sequence number consumed.
4. Select a branch (pre-effect state), then merge it with the action outcome.
5. Apply the repeat policy. Repeats are counted per *outcome* (action + branch), so the post-fix validation
   `nslookup` is not a repeat of the diagnostic one.
   * `diminish` drops positive deltas on repeats.
   * `penalize` also applies a penalty to every repeat.
   * Any mode applies `penalty` beyond `free_repeats`.
6. Apply effects, add score deltas, and advance `minutes` by `time_cost`. Advancing time also decays
   character patience variables.
7. Render the first matching output and every matching message, after effects, and append them to the
   transcript.
8. Run the post-step loop, bounded to 8 iterations. Each iteration runs auto-advance for phases,
   auto-reveal for facts, and events. `after_action` events match only the step's own action.
9. Check completion in this order: a pending `complete` effect, `failure`, `success`, `max_sim_minutes`,
   `max_actions`, then a terminal phase.

The outcome holds:

* `seq`, `accepted`, `matched` (action|fact|unknown), `action_id`, `label`, `branch`
* `outputs[]`, `messages[]`, `events[]`, `revealed_facts[]`, `problems_added`, `problems_removed`
* `phase_before`, `phase_after`, `phase_changed`
* `score_deltas`, `classification`, `feedback`, `hint`, `time_cost`, `sim_minutes`
* `ended`, `end_reason`, `variables_changed`, `notices`

### Projections

* **`learner_view(definition, state)`** returns `meta`, `phase`, and `phases` (with done, current or
  upcoming status). It also returns visible `panels` with their rendered data, visible `tools` (including
  whether each accepts commands or free text), and `characters` with a public patience value.
  The remaining fields are `revealed_facts`, public `variables`, `problems`, `transcript`, `available_actions`,
  `sim_minutes`, `target_minutes`, `action_count`, `ended` and `end_reason`.
  * Available actions carry only `id`, `tool`, `label`, `kind`, `description`, `character` and
    `input{type, placeholder, min_length, choices}`. No effects, scores, branches or classifications are
    included.
* **`public_outcome(definition, outcome, include_feedback)`** removes the internal variable names, score
  deltas, classification, feedback and hint. The last four are put back only in practice mode.
* **`sensitive_values(definition, state)`** returns the values that must never appear in AI text. These are
  every secret value, and every internal value the learner has not already been shown in the transcript.

## 6. Validation and repair

`validate(definition)` returns `{valid, errors[], warnings[], stats}`. Each issue has a `code`, a `path` and a
`message`.

* **Errors:**
  * `schema`: a Pydantic error
  * `duplicate_id`
  * `unknown_ref`: tools, panels, characters, facts, intents, variables, phases, events, dimensions, actions
    and problems, including references inside every condition
  * `weights`: the weights don't sum to 100
  * `scoring`: bad `max_points`, a bad efficiency window, or no bands
  * `transition`: an auto-advance target that isn't allowed
  * `unreachable_phase`
  * `dead_end`: a phase with no way forward and no way to finish
  * `no_completion`
  * `secret_leak`: a secret variable interpolated into learner-visible text
  * `regex`: an invalid command pattern, or one longer than 300 characters
  * `action`: an `ask` without a character, a command without patterns, a chat action without intents, or a
    choice action without choices
  * `intent`: an intent with no patterns or examples
  * `event`: a trigger missing a field it needs
  * `condition`: a malformed condition
* **Warnings:**
  * `panel_type`: an unknown panel type
  * `unreachable_max`: a dimension that can't reach `max_points` on any path
  * `no_correct_actions`
  * `empty_phase`
  * `dead_end`: no outgoing transitions, although completion exists
  * removing a problem that is never added
  * no band covering 0

Publishing requires zero errors. Drafts may be saved with semantic errors, but structural (schema) errors are
rejected with 422.

`repair(raw)` sanitises machine-generated JSON. It:

* drops unknown keys
* adds default phases and dimensions
* normalises weights to 100
* drops actions that use unknown tools, and chat actions without valid intents
* removes dangling reveals, transitions and variable effects
* drops `after_action` events that point at removed actions

It returns `(fixed, notes)`. The result must still pass `validate`.

## 7. Builder graph (React Flow)

`to_graph(definition)` returns:

```json
{"version": 1, "initial_phase": "INITIAL",
 "nodes": [{"id": "phase:DIAGNOSIS", "type": "phase", "position": {"x": 720, "y": 0}, "data": {<Phase>}},
           {"id": "action:record_diagnosis", "type": "action", "position": {...}, "data": {<Action without branches>}},
           {"id": "branch:record_diagnosis:0", "type": "branch", "position": {...}, "data": {<Branch>}},
           {"id": "event:customer_escalates", "type": "event", "position": {...}, "data": {<Event>}}],
 "edges": [{"id": "t:INITIAL->INVESTIGATION:auto:0", "source": "phase:INITIAL", "target": "phase:INVESTIGATION",
            "type": "transition", "data": {"auto": true, "when": {...}}},
           {"id": "c:DIAGNOSIS:x", "source": "phase:DIAGNOSIS", "target": "action:x", "type": "contains"},
           {"id": "b:x:0", "source": "action:x", "target": "branch:x:0", "type": "branch", "data": {"order": 0}},
           {"id": "x:branch:x:0->RESOLUTION", "source": "branch:x:0", "target": "phase:RESOLUTION",
            "type": "effect_transition"},
           {"id": "tr:a->e:after", "source": "action:a", "target": "event:e", "type": "triggers",
            "data": {"kind": "after_action"}}]}
```

Edge types:

* `transition`: a phase's allowed next phase. With `data.auto` it is an auto-advance rule, and `data.when`
  holds the rule's condition.
* `contains`: the phases the action is restricted to. An action with no `contains` edges is available in
  every phase.
* `branch`: from an action to one of its branches. `data.order` gives the order.
* `effect_transition`: a forced transition effect from an action, branch or event.
* `triggers`: `data.kind` is `after_action`, which defines the event's trigger, or `effect`, which is
  informational.

`from_graph(graph, base)` rebuilds phases, actions (including `phases` and branches) and events from the
nodes and edges. It keeps every other section from `base`.

* New nodes may omit `data.id`. The id after `type:` in the node id is used instead.
* Transition effects are rewritten only when the edges differ from the data, so the round trip is lossless.
  The tests check this for all templates.
* Positions are layout only. The API stores the last graph in `simulation_scenarios.builder_graph`, and
  `merge_positions` restores them.

## 8. Templates

| Key | Domain | Highlights |
|---|---|---|
| `it-helpdesk-network` (flagship) | Level 1/2 IT helpdesk | 52 actions; 15 chat intents; realistic `ipconfig /all`, `ping`, `nslookup` (incl. against a specific server), `tracert`, `ipconfig /flushdns /release /renew /displaydns`, `netsh int ip reset`, `Get-DnsClientServerAddress`, `Set-DnsClientServerAddress` (reset / public / corporate), `Test-NetConnection`, `Get-NetAdapter`, `Restart-Computer`; System Information panel that reveals the stale static DNS after the VPN 5.2.1 update; KB articles; directory admin (password reset trap); 3 seeded variations (Wi-Fi/Ethernet, 10.0.0.53/54); customer patience with follow-up, escalation and manager events; scoring 35/25/15/15/10 |
| `phishing-email-investigation` | SOC analyst L1 | Headers (SPF/DKIM/DMARC), URL sandbox, SIEM scoping, interview of the user who clicked (MFA fatigue), quarantine / block / account recovery, proportionality (mass reset is wrong), attacker persistence event if recovery is slow, custom phases (Triage → Analysis → Containment → Recovery → Reporting) |
| `restaurant-food-safety-complaint` | Hospitality duty manager | Guest-safety-first scoring, angry guest with fast-decaying patience, server/chef interviews, kitchen docket log, allergen matrix, critical "ask guest to leave", incident report keyword scoring, symptoms-worsen event |

In the flagship, the optimal path takes about 23 simulated minutes and scores 100 (Expert). The poor paths
include:

* closing the ticket before the fix, which is critical and capped at 49
* reinstalling the driver (+20 minutes), resetting the password, `netsh` before diagnosis and
  `/release`, which exhaust the customer's patience, trigger an escalation event and fail
* escalating in the first 15 minutes, which ends the run as `escalated` with zero decision-making points

All three paths are covered by tests.

## 9. Authoring guide

1. **Start from a template, or from the AI builder.** Use `POST /simulations/from-template` or
   `POST /simulations/ai-build`. Both create a *draft*. Then edit it as JSON (`PUT /draft`) or in the graph
   builder (`PUT /graph`).
2. **Write down the ground truth first.** Put it in a `secret` variable. Model the observable symptoms as
   `internal` variables that outputs interpolate. Use `public` variables only for things the learner should
   see as status (meters, ticket status).
3. **Design the evidence trail.** Each key diagnostic sets an evidence flag (`ev_*`). Use those flags in
   phase `auto_advance` rules, so that the phase reflects what the learner has actually established.
4. **Give every tempting wrong action a consequence.** That can be time (`time_cost`), patience (`inc`), score
   deltas, a character reaction, an event, or `complete: failure` for critical errors. Always add `feedback`
   that explains *why*.
5. **Use branches for state-dependent behaviour.** The same command can be a diagnostic before the fix and a
   validation after it. Put the conditional outputs first and the fallback last.
6. **Write chat intents generously.** Add several short patterns plus one or two example sentences. Test them
   with `resolve_input`. Use a fact with its own `intents` for useful but unscored information.
7. **Calibrate scoring.** Play the optimal path, note the points per dimension, and set `max_points` to
   80–90% of that. Then check that poor paths land in Fail or Needs Improvement.
8. **Add feedback rules.** Cover strengths, improvements (tied to the traps) and missed steps (tied to the
   steps that should have happened).
9. **Validate, preview as a manager, then publish.** Managers can pass a `seed` when starting a session to
   test each variation. Publishing freezes an immutable version. Running sessions stay pinned to the version
   they started on, and a new draft opens automatically.

## 10. HTTP API

All routes are under `/api/v1`. Creating, publishing and playing require the plan feature `simulations`
(`plans.require_feature`, 402). Creating checks the `max_simulations` limit (402).

| Method and path | Permission | Notes |
|---|---|---|
| `GET /simulations/templates` | simulations.manage | Template summaries |
| `GET /simulations` | simulations.manage or learning.access | Learners see published only. Filters: `status`, `course_id`, `industry`, `search` |
| `POST /simulations` | simulations.manage | From `definition`, from `template_key`, or a starter skeleton (`title`) |
| `POST /simulations/from-template` | simulations.manage | `{template_key, title?, course_id?}` |
| `GET/PATCH/DELETE /simulations/{id}` | GET: manage or learning.access (published only). PATCH/DELETE: manage | DELETE is a soft delete |
| `GET/PUT /simulations/{id}/draft` | simulations.manage | PUT returns the validation report. Schema errors return 422 |
| `GET/PUT /simulations/{id}/graph` | simulations.manage | `from_graph` + validate. Positions are kept |
| `POST /simulations/{id}/validate` | simulations.manage | Optional `{definition}`. Defaults to the draft |
| `POST /simulations/{id}/publish` | simulations.manage | 422 `validation_failed` with the report |
| `GET /simulations/{id}/versions[/{n}]` | simulations.manage | |
| `POST /simulations/ai-build` | simulations.manage | `{description, industry?, difficulty?, learner_role?, title?, course_id?}`. Returns `{simulation, scenario_id, validation, source: ai|fallback, repairs[]}`. Always a draft |
| `GET /simulations/{id}/analytics` | simulations.manage or analytics.view | |
| `GET /simulations/{id}/sessions` | simulations.manage or submissions.review | |
| `POST /simulations/{id}/sessions` | learning.access | Starts a session, or resumes the active one (`resumed: true`). 409 `attempt_limit` |
| `GET /simulation-sessions` | authenticated | Lists the caller's sessions |
| `GET /simulation-sessions/{id}` | owner, simulations.manage or submissions.review | `SessionOut` |
| `POST /simulation-sessions/{id}/actions` | owner (learning.access) | `{action_id?, tool?, character?, input?, client_seq}`. Returns `StepOut` |
| `POST /simulation-sessions/{id}/chat` | owner (learning.access) | `{character_id, message, client_seq?}`. Returns `StepOut` with `reply` |
| `POST /simulation-sessions/{id}/finish` | owner | Scores a run in progress (`end_reason: incomplete`). Idempotent |
| `POST /simulation-sessions/{id}/abandon` | owner | Never passes, and emits no completion event |
| `GET /simulation-sessions/{id}/result` | owner or staff | 409 while the session is active |
| `GET /simulation-sessions/{id}/replay` | owner (finished sessions only) or staff | Learners get public projections. Staff get full outcomes and variables |

* **`SessionOut`** contains `id`, `simulation_id`, `scenario_id`, `status`, `attempt_number`, `is_graded`,
  `show_feedback`, `started_at`, `completed_at`, `expires_at`, `phase`, `sim_minutes`, `action_count`,
  `next_seq`, `resumed`, `view` (from `learner_view`) and `result` (once the session is finished).
* **`StepOut`** contains `session_id`, `seq`, `replayed`, `accepted`, `outcome` (from `public_outcome`),
  `reply` (`{from, name, text, ai_phrased}`, chat only), `status`, `phase`, `sim_minutes`, `ended`,
  `next_seq`, `view` and `result`.
* **`ResultOut`** contains `total_score`, `band`, `passed`, `dimensions[{id, name, weight, raw, max_points,
  percent, score}]`, `feedback{summary, strengths, improvements, missed_steps, tips, critical_actions,
  incorrect_actions, timeline}`, `narrative`, `end_reason`, `sim_minutes` and `target_minutes`.

Sequencing and persistence:

* **Idempotency.** `client_seq` must equal `next_seq`. Re-sending a processed seq returns the stored outcome
  with `replayed: true`. Any other value returns 409 `sequence_conflict` with `{expected}`. Rejected
  outcomes, such as an unmet precondition, are not persisted and do not consume a seq.
* **Persistence.** Every accepted step writes a `simulation_actions` row (input, full outcome, phase
  before and after, deltas, classification, AI reply). A `simulation_states` snapshot is written on start,
  on phase changes, on variable changes and at the end.
* **Feedback visibility.** Graded simulations hide classification, score deltas, feedback and hints during
  play unless `settings.show_feedback_when_graded` is set. Practice simulations (`is_graded: false`) show
  them.
* **Timeouts.** After `settings.session_timeout_minutes` of inactivity, a session becomes `expired` on its
  next access, is scored, and does not pass.
* **Completion.** When the engine ends the run, or the learner calls finish, the session is scored and
  `simulation.completed` is emitted with exactly `{session_id, simulation_id, course_id, total_score, band,
  passed, organisation_id, user_id}`. The progress module uses it to complete linked simulation lessons.
* **Analytics.** The analytics endpoint returns:
  * attempts, learners, active, completed, abandoned and expired counts
  * completion rate and pass rate
  * average, median, minimum and maximum score
  * average and median score per dimension
  * band distribution
  * the most common incorrect and critical actions, with labels
  * average simulated and real minutes
  * phase reach and phase drop-off

## 11. AI constraints

* **AI builder.** The builder calls `generate_json(feature="simulation_builder")` with a schema hint (a
  complete generic skeleton). The output is always run through `repair`, then `validate`. If the AI is
  unavailable, gated (plan, budget or disabled) or invalid, the deterministic generator is used instead:
  * IT and network requests adapt the flagship (title derived from the request, difficulty and learner role
    detected from "Level 1/2/3").
  * Security requests adapt the phishing template, and hospitality requests adapt the restaurant template.
  * Anything else becomes a complete fault-diagnosis skeleton with `[Instructor: …]` placeholders.

  The result is saved as a **draft** with `ai_generated=true` and tagged `ai_draft` and `needs_review`. It is
  never published automatically.
* **Character voice.** The engine always produces the canonical reply. If `settings.ai_character_voice` is set
  and the provider is not the offline one, `generate_text(feature="simulation_character")` may rephrase it.
  * The model receives only the persona, the facts revealed so far (including this turn's), the canonical
    `REQUIRED_REPLY` and the recent conversation with that character. It is told not to add information.
  * Before use, the AI text is rejected if it contains any `sensitive_values`: secret values, or internal
    values not yet shown. It is also rejected if it is empty or far longer than the canonical reply. In those
    cases the canonical reply is used.
  * The AI text is stored in `simulation_actions.ai_generated_reply`, and the canonical text is kept in the
    transcript entry (`canonical_text`).
  * Scoring never depends on the AI.
* **Debrief.** A short narrative may be written from the result JSON (scores, strengths, improvements). The
  fallback is the engine summary.
* All AI calls run inside a database SAVEPOINT. A gateway failure falls back to the deterministic path and
  never breaks the learner's step.

## 12. Behaviour analysis (integrity)

On completion, the service may write supplementary `integrity_signals` (`target_type = simulation_session`).
They are **never** used to adjust scores. Humans review them.

* **`timing`** is raised for a score of 95 or more in under 20% of the target time, measured in real seconds.
* **`identical_sequence`** is raised when the same sequence of actions *and* the same free-text inputs as
  another learner's session for the same simulation are seen. The session must contain at least 3
  chat or document texts, because identical button sequences alone are expected from good learners. The
  fingerprint is stored in `state.integrity`.

## 13. Testing

```
cd apps/api
TEST_DATABASE_URL=postgresql+asyncpg://praxis:praxis@localhost:5432/praxis_test_sim \
  /home/user/venv/bin/python -m pytest -q tests/test_auth.py tests/test_sim*.py ../../packages/simulation-engine/tests
```

* The engine tests cover the DSL (including safety), intent matching, the optimal and poor paths for every
  template, variations and determinism, events, repeats, rejections, the projections and leak checks,
  validation and repair, and the graph round trip.
* The API tests cover authoring, versions, the graph, plan gating and limits, the AI builder (fallback and
  repair), the optimal play-through (Expert band, the event payload, a leak scan of every response),
  practice-mode consequences, idempotency, attempt limits, expiry, isolation across tenants and users,
  analytics, integrity signals, AI voice screening and the seed helper.
* Async code under SQLAlchemy runs inside greenlets. Measure coverage of `app.modules.simulations` with
  `concurrency = greenlet,thread` in the coverage configuration.
