"""Praxis simulation engine: declarative, deterministic, auditable training simulations.

Public API::

    from simulation_engine import (SimulationDefinition, parse_definition, validate, repair, start, step,
                                   finish, learner_view, public_outcome, to_graph, from_graph,
                                   load_template, list_templates)
"""

from simulation_engine.conditions import ConditionError, EvalContext, evaluate, truthy
from simulation_engine.engine import (
    UNKNOWN_ACTION_ID,
    EngineError,
    InvalidInput,
    Resolution,
    SimulationEnded,
    StepResult,
    UnknownAction,
    available_actions,
    is_available,
    learner_view,
    public_outcome,
    public_variables,
    resolve_input,
    sensitive_values,
    start,
    step,
)
from simulation_engine.graph import from_graph, merge_positions, to_graph
from simulation_engine.schema import SCHEMA_VERSION, SimulationDefinition, parse_definition
from simulation_engine.scoring import band_for, compute_scores, finish
from simulation_engine.templates import list_templates, load_template
from simulation_engine.validation import ValidationReport, repair, validate

__version__ = "1.0.0"

__all__ = [
    "SCHEMA_VERSION",
    "UNKNOWN_ACTION_ID",
    "ConditionError",
    "EngineError",
    "EvalContext",
    "InvalidInput",
    "Resolution",
    "SimulationDefinition",
    "SimulationEnded",
    "StepResult",
    "UnknownAction",
    "ValidationReport",
    "available_actions",
    "band_for",
    "compute_scores",
    "evaluate",
    "finish",
    "from_graph",
    "is_available",
    "learner_view",
    "list_templates",
    "load_template",
    "merge_positions",
    "parse_definition",
    "public_outcome",
    "public_variables",
    "repair",
    "resolve_input",
    "sensitive_values",
    "start",
    "step",
    "to_graph",
    "truthy",
    "validate",
]
