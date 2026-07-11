# Interview Deliverables Design

## Goal

Turn the training outline and final report into a professional Chinese interview-coaching deliverable. The product will generate one evidence-based analysis and present it in two views: an actionable candidate view and a detailed consultant view.

## Scope

This change covers the outline shown before practice, the report data generated at session completion, and the candidate and consultant report pages. It does not add video-based emotion scoring, resume parsing, or a new database table in this iteration.

## Principles

- Every score and recommendation must connect to a concrete answer, question, or observed gap.
- The candidate view prioritizes clear next actions over internal scoring mechanics.
- The consultant view preserves enough evidence to explain the evaluation in a follow-up service conversation.
- AI prompts request structured Chinese output and prohibit generic recommendations without answer-specific evidence.
- Existing stored reports remain renderable through compatibility defaults until they are regenerated.

## Training Outline

The outline becomes a pre-interview playbook with the following sections:

1. Training overview: target company, role, estimated duration, and training objective.
2. Role success profile: three to five core competencies tailored to the task context.
3. Stage plan: the purpose, expected outcome, and time allocation for each enabled stage.
4. Question cards: question, why the interviewer asks it, what a strong answer must prove, follow-up direction, evaluation criteria, difficulty, and response time limit.
5. Preparation checklist: reusable project stories, quantitative evidence, and role-specific materials to prepare before starting.

The generated question object gains `assessmentIntent`, `answerFramework`, and `scoringCriteria`. The generated outline gains `trainingObjective`, `coreCompetencies`, `stageObjectives`, and `preparationChecklist`.

## Evidence-Based Report Data

The completion analysis produces a single structured report containing:

- `readinessVerdict`: readiness level, one-sentence judgement, and the highest-priority risk.
- `overallScore` and five sub-scores, each with a concise explanation.
- `perQuestionFeedback`: question text, answer evidence, score rationale, strengths, gaps, a concrete improvement action, and a suggested answer rewrite.
- `competencyAssessment`: strengths and risks mapped to the target role competencies.
- `priorityActions`: the three highest-impact improvements, ordered by urgency.
- `nextTrainingPlan`: a seven-day schedule with drill, success criterion, and suggested stage.
- Existing expression, answer-quality, strategy, and weak-tag fields retained for compatibility and summary presentation.

Evidence is derived only from submitted answers and their linked questions. When an answer lacks enough evidence, the model states that explicitly instead of inventing achievements or quotations.

## Candidate View

The candidate report is Chinese-first and follows this reading order:

1. Interview conclusion: readiness level, overall score, and a plain-language judgement.
2. What to improve first: the top three actions with a concrete training target.
3. Capability scorecard: five scores with plain explanations.
4. Question-by-question replay: original question, performance diagnosis, cited answer evidence, what to say differently, and an example answer structure.
5. Seven-day training plan: daily drill, time recommendation, and completion criterion.

The candidate view intentionally omits consultant-only risk labels and internal service guidance.

## Consultant View

The consultant report uses the same generated data but adds:

1. Candidate positioning: target role fit, readiness conclusion, and hiring-risk assessment.
2. Evidence ledger: score rationale and the source answer for every material judgement.
3. Competency matrix: role competency, observed evidence, risk, and suggested coaching response.
4. Session replay: question, candidate answer, AI follow-up, score, and coaching recommendation.
5. Service follow-up plan: the next recommended training intervention and how to explain it to the candidate.

## Generation and Compatibility

The OpenAI-compatible provider prompt defines the required Chinese JSON shape and requires specific, answer-grounded output. The mock provider produces equally complete deterministic data so local demos remain persuasive without API credentials.

Storage serialization accepts missing new fields in old reports and supplies explicit empty or compatibility values. Newly generated reports always persist the enriched structure. No destructive migration is required for this iteration.

## Error Handling

- Invalid AI JSON continues to fail validation before persistence.
- If an answer is too short to support a conclusion, the report marks the related assessment as insufficient evidence and proposes a targeted re-answer drill.
- Empty per-question feedback is rendered as an explicit incomplete-analysis state rather than generic tags.

## Testing

- Unit tests prove enriched outline and report schemas accept valid data and reject missing required evidence fields for new reports.
- Provider tests verify prompts request Chinese, evidence-based output and parse the enriched structure.
- Candidate and consultant view tests verify the two audiences receive their respective sections.
- Compatibility tests verify a legacy stored report renders without runtime failure.

## Out of Scope

- Automated facial expression, eye-contact, or voice tone scoring.
- Export to PDF or branded consultant templates.
- Resume ingestion and job-description retrieval workflows.
