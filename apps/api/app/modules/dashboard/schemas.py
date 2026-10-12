"""Dashboard response contracts (the web app builds against these exact shapes)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class LearnerStats(BaseModel):
    courses_in_progress: int
    courses_completed: int
    certificates: int
    streak_days: int
    longest_streak: int
    average_score: float | None
    learning_minutes_week: int


class NextLessonRef(BaseModel):
    id: str
    title: str
    lesson_type: str


class CurrentCourse(BaseModel):
    enrolment_id: uuid.UUID
    course_id: uuid.UUID
    title: str
    thumbnail_url: str | None
    category: str | None
    difficulty: str | None
    progress_pct: float
    status: str
    due_date: date | None
    last_accessed_at: datetime | None
    next_lesson: NextLessonRef | None


class Deadline(BaseModel):
    type: str  # course | assignment
    id: uuid.UUID  # enrolment id (course) | assignment id (assignment)
    title: str
    course_id: uuid.UUID | None
    course_title: str | None
    due_at: datetime
    status: str  # overdue | not_started | in_progress | draft | returned


class SimulationResult(BaseModel):
    session_id: uuid.UUID
    simulation_id: uuid.UUID
    title: str
    total_score: float | None
    band: str | None
    passed: bool | None
    completed_at: datetime | None


class SkillItem(BaseModel):
    skill_id: uuid.UUID
    name: str
    category: str | None
    proficiency: float


class CertificateItem(BaseModel):
    id: uuid.UUID
    certificate_number: str
    course_title: str
    issued_at: datetime


class RecommendationItem(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    reason: str
    target_type: str | None
    target_id: uuid.UUID | None
    course_id: uuid.UUID | None


class ActivityItem(BaseModel):
    type: str
    title: str
    at: datetime
    link: str | None


class HeatmapDay(BaseModel):
    day: str  # YYYY-MM-DD
    seconds: int


class LearnerDashboard(BaseModel):
    stats: LearnerStats
    current_courses: list[CurrentCourse]
    upcoming_deadlines: list[Deadline]
    simulation_results: list[SimulationResult]
    skills: list[SkillItem]
    certificates: list[CertificateItem]
    recommendations: list[RecommendationItem]
    recent_activity: list[ActivityItem]
    activity_heatmap: list[HeatmapDay]


class InstructorStats(BaseModel):
    courses_total: int
    courses_published: int
    total_enrolments: int
    total_learners: int
    average_completion_rate: float | None
    pending_reviews: int


class InstructorCourse(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    thumbnail_url: str | None
    current_version_number: int | None
    enrolments: int
    in_progress: int
    completed: int
    completion_rate: float | None
    average_score: float | None
    updated_at: datetime


class ReviewItem(BaseModel):
    submission_id: uuid.UUID
    assignment_id: uuid.UUID
    assignment_title: str
    user_id: uuid.UUID
    learner_name: str
    status: str
    submitted_at: datetime | None


class GenerationItem(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    course_id: uuid.UUID | None
    created_at: datetime


class InstructorDashboard(BaseModel):
    stats: InstructorStats
    courses: list[InstructorCourse]
    pending_reviews: int
    review_queue: list[ReviewItem]
    recent_generations: list[GenerationItem]
