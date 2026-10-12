"""Behaviour of the engine on the flagship IT helpdesk template."""

from __future__ import annotations

import copy
import json

import pytest
from sim_paths import HELPDESK_OPTIMAL, act, chat, play, term

from simulation_engine import (
    InvalidInput,
    SimulationEnded,
    UnknownAction,
    available_actions,
    finish,
    learner_view,
    load_template,
    public_outcome,
    resolve_input,
    sensitive_values,
    start,
    step,
)
from simulation_engine.engine import EngineError, render
from simulation_engine.conditions import EvalContext

SECRET = "stale_static_dns_after_vpn_update"


@pytest.fixture(scope="module")
def d():
    return load_template("it-helpdesk-network")


def test_optimal_path_scores_expert(d):
    state, outcomes = play(d, HELPDESK_OPTIMAL, seed=1)
    assert all(o["accepted"] for o in outcomes)
    assert all(o["matched"] == "action" for o in outcomes), [o["action_id"] for o in outcomes]
    assert state["ended"] and state["end_reason"] == "success"
    assert [p["phase"] for p in state["phase_history"]] == [
        "INITIAL", "INVESTIGATION", "DIAGNOSIS", "REMEDIATION", "VALIDATION", "RESOLUTION"]
    result = finish(d, state)
    assert result["band"] == "Expert" and result["total_score"] >= 95 and result["passed"]
    assert {x["id"]: x["percent"] for x in result["dimensions"]}["efficiency"] == 100
    fb = result["feedback"]
    assert len(fb["strengths"]) >= 4 and not fb["critical_actions"] and not fb["incorrect_actions"]
    assert not fb["missed_steps"]
    assert len(fb["timeline"]) == len(HELPDESK_OPTIMAL)
    assert "Passed" in fb["summary"]


@pytest.mark.parametrize("seed", [0, 1, 2, 3, 7, 11])
def test_optimal_path_works_for_every_variation(d, seed):
    s = start(d, seed)
    alias = s["variables"]["interface_alias"]
    steps = [x if x[0] or "Set-Dns" not in str(x[1]) else
             term(f'Set-DnsClientServerAddress -InterfaceAlias "{alias}" -ResetServerAddresses')
             for x in HELPDESK_OPTIMAL]
    state, _ = play(d, steps, state=s)
    assert finish(d, state)["band"] == "Expert"


def test_variations_are_deterministic_and_varied(d):
    assert start(d, 5) == start(d, 5)
    variations = {start(d, seed)["variation"] for seed in range(40)}
    assert variations == {"wifi_53", "wifi_54", "ethernet_53"}
    s = start(d, next(i for i in range(40) if start(d, i)["variation"] == "wifi_54"))
    out = step(d, s, None, "ipconfig /all", tool="terminal").outcome["outputs"][0]["text"]
    assert "10.0.0.54" in out


def test_replay_is_deterministic(d):
    a, _ = play(d, HELPDESK_OPTIMAL[:12], seed=3)
    b, _ = play(d, HELPDESK_OPTIMAL[:12], seed=3)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_step_does_not_mutate_input_state(d):
    s = start(d, 0)
    snapshot = copy.deepcopy(s)
    step(d, s, "review_ticket")
    assert s == snapshot


def test_close_before_fix_is_critical_fail(d):
    state, outcomes = play(d, [act("review_ticket"), act("close_ticket")])
    assert outcomes[-1]["classification"] == "critical" and state["end_reason"] == "failure"
    result = finish(d, state)
    assert result["band"] == "Fail" and not result["passed"] and result["critical_failure"]
    assert result["total_score"] <= 49
    assert result["feedback"]["critical_actions"][0]["action_id"] == "close_ticket"
    with pytest.raises(SimulationEnded):
        step(d, state, "review_ticket")


def test_close_after_fix_without_validation_is_critical(d):
    state, outcomes = play(d, [term("Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ResetServerAddresses"),
                               act("close_ticket")])
    assert outcomes[0]["branch"] == "guessed"
    assert outcomes[-1]["classification"] == "critical"
    assert not finish(d, state)["passed"]


def test_shotgun_path_has_consequences_and_fails(d):
    steps = [
        act("open_system_info"), act("reinstall_driver"), act("reset_password"),
        term("netsh int ip reset"), term("ipconfig /release"), term("Restart-Computer -Force"),
    ]
    state, outcomes = play(d, steps)
    by_id = {o["action_id"]: o for o in outcomes}
    assert by_id["reinstall_driver"]["time_cost"] == 20 and by_id["reinstall_driver"]["classification"] == "incorrect"
    assert any("password" in m["text"].lower() for m in by_id["reset_password"]["messages"])
    assert by_id["netsh_reset"]["branch"] == "shotgun"
    assert by_id["netsh_reset"]["score_deltas"]["troubleshooting_process"] < 0
    assert any("Teams" in m["text"] for m in by_id["release_renew"]["messages"])
    # patience ran out → the customer escalated (event) and a problem was added
    assert state["variables"]["customer_patience"] == 0
    assert state["fired_events"].get("customer_escalates") == 1
    assert any(p["id"] == "customer_escalation" for p in state["problems"])
    result = finish(d, state)
    assert not result["passed"] and result["band"] == "Fail"
    texts = " ".join(i["text"] for i in result["feedback"]["improvements"])
    assert "driver" in texts and "password" in texts.lower()
    assert result["feedback"]["incorrect_actions"]
    assert result["end_reason"] == "incomplete"


def test_escalating_too_early_ends_simulation(d):
    state, outcomes = play(d, [act("review_ticket"), act("escalate_ticket")])
    assert outcomes[-1]["branch"] == "too_early" and state["phase"] == "ESCALATED"
    assert state["end_reason"] == "escalated"
    result = finish(d, state)
    assert not result["passed"]
    assert {x["id"]: x["raw"] for x in result["dimensions"]}["decision_making"] == 0


def test_escalating_after_diagnosis_is_bounced(d):
    state, outcomes = play(d, [act("record_diagnosis", {"choice": "stale_static_dns"}), act("escalate_ticket")])
    assert outcomes[-1]["branch"] == "diagnosed" and not state["ended"]


def test_wrong_diagnosis_and_public_dns(d):
    state, outcomes = play(d, [
        act("record_diagnosis", {"choice": "driver_fault"}),
        term("Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ServerAddresses 8.8.8.8"),
        term("nslookup intranet.corp.local"), term("nslookup google.com"), term("ping intranet.corp.local"),
        term("ping google.com"), chat("Can you try again now?"),
    ])
    assert outcomes[0]["classification"] == "incorrect"
    assert outcomes[1]["classification"] == "incorrect"
    assert "Non-existent domain" in outputs_text(outcomes[2])
    assert "142.250.70.206" in outputs_text(outcomes[3])
    assert "could not find host" in outputs_text(outcomes[4])
    assert "142.250.70.206" in outputs_text(outcomes[5])
    assert "Google works now" in outcomes[6]["messages"][0]["text"]
    result = finish(d, state)
    assert any(i["id"] == "i_public_dns" for i in result["feedback"]["improvements"])


def outputs_text(outcome):
    return "\n".join(o["text"] for o in outcome["outputs"])


def test_terminal_outputs_depend_on_state(d):
    s = start(d, 1)
    before = step(d, s, None, "nslookup intranet.corp.local", tool="terminal").outcome
    assert "timed out" in outputs_text(before) and "10.0.0.5" in outputs_text(before)
    s, _ = play(d, [term("Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ResetServerAddresses")], state=s)
    after = step(d, s, None, "nslookup intranet.corp.local", tool="terminal").outcome
    assert "10.20.5.25" in outputs_text(after) and after["branch"] == "validated"
    for cmd, needle in [("ipconfig /all", "10.20.1.10"), ("Get-DnsClientServerAddress", "10.20.1.10"),
                        ("ping intranet", "10.20.5.25"), ("tracert 8.8.8.8", "Trace complete"),
                        ("ipconfig /displaydns", "A (Host) Record"), ("Test-NetConnection intranet.corp.local -Port 443",
                                                                      "TcpTestSucceeded : True"),
                        ("nslookup intranet.corp.local 10.0.0.53", "timed out"),
                        ("nslookup google.com 10.20.1.11", "142.250.70.206"),
                        ("nslookup intranet.corp.local 9.9.9.9", "Non-existent"),
                        ("ipconfig", "10.20.30.57"), ("get-netadapter", "Up"), ("hostname", "FIN-LT-0457"),
                        ("whoami", "pshah"), ("help", "nslookup"), ("set-dnsclientserveraddress", "Specify"),
                        ("Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ServerAddresses 10.20.1.10,10.20.1.11",
                         "completed")]:
        o = step(d, s, None, cmd, tool="terminal").outcome
        assert needle in outputs_text(o), (cmd, outputs_text(o))
    broken = start(d, 1)
    for cmd, needle in [("tracert intranet.corp.local", "Unable to resolve"),
                        ("Test-NetConnection intranet.corp.local", "Name resolution"),
                        ("ipconfig /displaydns", "Name does not exist"), ("tnc", "PingSucceeded")]:
        o = step(d, broken, None, cmd, tool="terminal").outcome
        assert needle in outputs_text(o), (cmd, outputs_text(o))


def test_unknown_command_and_unknown_chat(d):
    s = start(d, 0)
    r = step(d, s, None, "format c:", tool="terminal")
    assert r.outcome["matched"] == "unknown" and "is not recognized" in outputs_text(r.outcome)
    assert "format c:" in outputs_text(r.outcome)
    assert r.outcome["score_deltas"] == {}  # unknown commands are noise, not a penalty
    r = step(d, r.state, None, "the purple monkey dishwasher", character="priya")
    assert r.outcome["matched"] == "unknown"
    assert "not very technical" in r.outcome["messages"][0]["text"]
    assert r.outcome["score_deltas"] == {"communication": -1.0}
    s = r.state
    for _ in range(6):
        s = step(d, s, None, "zzz qqq", character="priya").state
    assert s["score"]["communication"] == -5.0  # capped at max_penalised
    assert s["unknown_inputs"] == 8


def test_chat_reveals_facts_only_when_asked(d):
    s = start(d, 0)
    view = learner_view(d, s)
    assert view["revealed_facts"] == []
    assert "VPN update" not in json.dumps(view)
    r = step(d, s, None, "When did this start?", character="priya")
    assert [f["id"] for f in r.outcome["revealed_facts"]] == ["f_started"]
    assert "VPN update" in r.outcome["messages"][0]["text"]
    # a fact with its own intents can be revealed without an action
    r2 = step(d, r.state, None, "Are you locked out or is it a password problem?", character="priya")
    assert r2.outcome["matched"] == "fact" and r2.outcome["revealed_facts"][0]["id"] == "f_password"
    assert {f["id"] for f in learner_view(d, r2.state)["revealed_facts"]} == {"f_started", "f_password"}


def test_precondition_rejections(d):
    s = start(d, 0)
    r = step(d, s, None, "Basically the DNS server setting was wrong, I fixed it", character="priya")
    assert not r.outcome["accepted"] and r.outcome["reason"] == "precondition_failed"
    assert "not very technical" in r.outcome["messages"][0]["text"]
    assert r.state == s
    r = step(d, s, "gui_set_dns_automatic")
    assert not r.outcome["accepted"]
    s2 = step(d, s, "acknowledge_ticket").state
    r = step(d, s2, "acknowledge_ticket")  # block repeat policy
    assert r.outcome["reason"] == "precondition_failed"
    r = step(d, s, "write_resolution_notes", {"text": "short"})
    assert r.outcome["reason"] == "invalid_input"


def test_invalid_requests_raise(d):
    s = start(d, 0)
    with pytest.raises(UnknownAction):
        step(d, s, "no_such_action")
    with pytest.raises(InvalidInput):
        step(d, s, "record_diagnosis", {"choice": "nope"})
    with pytest.raises(InvalidInput):
        step(d, s, "review_ticket", 42)
    with pytest.raises(EngineError):
        step(d, s, None, "hello")
    with pytest.raises(EngineError):
        step(d, s, None, "hello", tool="no_tool")
    with pytest.raises(EngineError):
        step(d, s, None, "hello", character="nobody")


def test_repeated_actions_diminish(d):
    s, outs = play(d, [term("ipconfig /all")] * 4)
    assert outs[0]["score_deltas"] == {"technical_accuracy": 3.0, "troubleshooting_process": 2.0}
    assert outs[1]["score_deltas"] == {} and outs[2]["score_deltas"] == {}
    assert outs[3]["score_deltas"] == {"efficiency": -0.5}  # beyond free repeats
    assert s["action_counts"]["ipconfig_all"] == 4


def test_gui_fix_and_diagnosed_branch(d):
    s, outs = play(d, [term("ipconfig /all"), term("nslookup intranet.corp.local"), act("open_system_info"),
                       act("gui_set_dns_automatic"), act("gui_set_dns_automatic")])
    assert outs[3]["branch"] == "diagnosed" and s["variables"]["connectivity_fixed"]
    assert outs[4]["branch"] == "already_fixed"
    view = learner_view(d, s)
    panel = next(p for p in view["panels"] if p["id"] == "system_info")
    assert panel["data"]["dns_assignment"] == "Automatic (DHCP)"


def test_time_events_fire(d):
    s = start(d, 0)
    s, _ = play(d, [act("read_kb_vpn")] * 16, state=s)  # 32 sim-minutes of reading
    assert s["fired_events"].get("customer_follow_up") == 1
    assert any(e.get("kind") == "notice" and "follow-up" in e["text"] for e in s["transcript"])


def test_timeout_completion(d):
    s = start(d, 0)
    s["minutes"] = 119.9
    r = step(d, s, "review_ticket")
    assert r.state["ended"] and r.state["end_reason"] == "timeout"


def test_learner_view_never_contains_secrets(d):
    state = start(d, 0)
    blobs = [json.dumps(learner_view(d, state))]
    for st in HELPDESK_OPTIMAL[:-1]:
        aid, inp, tool, ch = st
        r = step(d, state, aid, inp if aid else {"text": inp}, tool=tool, character=ch)
        state = r.state
        blobs.append(json.dumps(public_outcome(d, r.outcome, include_feedback=True)))
        blobs.append(json.dumps(learner_view(d, state)))
    for b in blobs:
        assert SECRET not in b
        assert "root_cause" not in b
        assert '"classification"' not in b or "feedback" in b
    view = learner_view(d, state)
    assert set(view["variables"]) == {"ticket_status", "customer_patience"}
    assert view["characters"][0]["patience"] is not None
    for a in view["available_actions"]:
        assert set(a) == {"id", "tool", "label", "kind", "description", "character", "input"}
    assert not any(a["kind"] == "command" and a["tool"] == "terminal" for a in view["available_actions"])
    assert len(available_actions(d, state, include_unlisted=True)) > len(view["available_actions"])


def test_public_outcome_hides_grading_unless_allowed(d):
    r = step(d, start(d, 0), "record_diagnosis", {"choice": "driver_fault"})
    graded = public_outcome(d, r.outcome)
    assert "classification" not in graded and "feedback" not in graded and "score_deltas" not in graded
    practice = public_outcome(d, r.outcome, include_feedback=True)
    assert practice["classification"] == "incorrect" and practice["feedback"]
    unknown = step(d, start(d, 0), None, "blah", tool="terminal").outcome
    assert public_outcome(d, unknown)["action_id"] is None
    changed = step(d, start(d, 0), "acknowledge_ticket").outcome
    assert public_outcome(d, changed)["variables_changed"] == ["customer_patience", "ticket_status"]


def test_sensitive_values(d):
    s = start(d, 0)
    values = sensitive_values(d, s)
    assert SECRET in values and "stale static dns after vpn update" in values
    assert "10.0.0.53" in values or "10.0.0.54" in values  # internal, not shown yet
    s2 = step(d, s, None, "ipconfig /all", tool="terminal").state
    shown = s2["variables"]["stale_dns"]
    assert shown not in sensitive_values(d, s2)


def test_resolve_input(d):
    s = start(d, 0)
    assert resolve_input(d, s, text="PING 8.8.8.8", tool="terminal").action_id == "ping_ip"
    assert resolve_input(d, s, text="ping -n 4 10.20.30.1", tool="terminal").action_id == "ping_gateway"
    assert resolve_input(d, s, text="what's the error you get?", character="priya").action_id == "ask_error_message"
    assert resolve_input(d, s, text="nothing", tool="ticket").kind == "unknown"


def test_render_handles_types():
    ctx = EvalContext(variables={"b": True, "f": 1.5, "l": [1, "a"], "n": None})
    assert render("{{b}} {{f}} {{l}} {{n}}|{{ missing }}", ctx) == "yes 1.5 1, a |"
