# AI Digital Human Interview Coaching Platform Design

Date: 2026-07-04
Status: Approved product design draft

## 1. Product Positioning

Build a service-delivery platform for AI digital human interview coaching.

The platform is not a generic chatbot or static question bank. It helps job seekers rehearse realistic interviews before real interviews, reduce stage fright, handle unexpected questions, and improve answers through AI-generated feedback and follow-up training plans.

The first version is optimized for a service provider workflow:

- The service team manages candidates, target companies, job descriptions, resumes, training tasks, and reports in a backend.
- Candidates enter a dedicated practice link and complete a guided interview session.
- AI handles both the interviewer role and the post-session coaching analysis.
- The system supports multiple AI providers through a unified orchestration layer, instead of depending on a single model or vendor.

## 2. Target Users

### Service Provider

The service provider creates and manages interview coaching services for job seekers.

Core needs:

- Manage candidate profiles and service progress.
- Upload or maintain candidate resumes, target job descriptions, company information, and job templates.
- Configure interview sessions for different companies, roles, stages, and difficulty levels.
- Review full training records, transcripts, reports, weak points, and next-step training plans.
- Reuse accumulated company and job templates as a service asset.

### Candidate

The candidate uses a dedicated link to complete interview training.

Core needs:

- Enter a realistic interview environment quickly.
- Practice with an AI digital human interviewer.
- Receive understandable, actionable feedback after the session.
- Rehearse weak areas repeatedly before the real interview.

## 3. First Version Direction

Use the service-delivery MVP path.

The first version should include:

- Service backend.
- Candidate practice link.
- Responsive web experience for desktop and mobile browsers.
- Digital human interview room with realistic avatar/video presence, real-time voice, and transcript support.
- Configurable training stages.
- Diverse interviewer templates and interviewer groups.
- AI-generated reports and next training plans.
- Persistent customer, training, report, and AI call records.

The first version should not prioritize high-fidelity real-person digital humans. It should first prove the coaching workflow, training effect, and service delivery loop. High-fidelity digital human video can be added after the service model is validated.

## 4. Roles and Permissions

### Service Backend User

The service backend user can:

- Create and edit candidate profiles.
- Upload resumes, job descriptions, company information, and supporting materials.
- Create company and job templates.
- Create interviewer templates and interviewer groups.
- Create training tasks and generate practice links.
- View full transcripts, recordings, reports, weak-point tags, and historical progress.
- Export or share candidate-facing reports.

In the MVP, all service backend users can manage all candidate data. Later versions can add administrator, coach, operator, and read-only roles.

### Candidate

The candidate can:

- Open a dedicated practice link.
- Complete device checks.
- Enter the digital human interview room.
- Complete configured training stages.
- View a simplified candidate-facing report.
- Start a targeted retraining session from the report page.

Candidates should only access their own practice sessions and candidate-facing reports.

## 5. Training Flow

A complete training session can include the following stages. The service backend can turn stages on or off, adjust order, and configure duration.

### 5.1 Training Preparation

The service provider creates a training task and binds:

- Candidate profile.
- Resume.
- Job description.
- Target company.
- Target role.
- Company template.
- Job template.
- Interviewer type or interviewer group.
- Training stage configuration.
- Expected duration.
- Report settings.

The system generates a session outline with questions, follow-up strategy, scoring dimensions, stage timing, and fallback behavior.

### 5.2 Practice Entry

The candidate opens the dedicated link and sees:

- Training theme.
- Target company and role.
- Expected duration.
- Interviewer type or interviewer group.
- Microphone and optional camera check.
- Privacy and data usage notice.

### 5.3 Digital Human Interview Room

The main interview interface includes:

- Digital human interviewer.
- Real-time voice conversation.
- Live transcript.
- Current question.
- Answer timer.
- Pause, continue, repeat question, and end session controls.
- Optional stage indicator, depending on backend configuration.

The MVP should use realistic avatar/video presence plus real-time voice and transcript support. It does not need fully realistic human-level mouth movement, expression, and body motion.

### 5.4 Configurable Training Stage Orchestrator

Training stages are configurable rather than hardcoded.

Supported MVP stages:

- Warm-up practice.
- Formal mock interview.
- Pressure follow-up.
- Experience deep dive.
- Case analysis.
- English or bilingual interview.
- AI review.
- Follow-up training recommendation.

Example configurations:

- First-time nervous candidate: warm-up + standard mock interview + review.
- Big tech final preparation: formal mock interview + pressure follow-up + experience deep dive + review.
- Foreign company training: English warm-up + hiring manager interview + panel follow-up + review.
- Weak-point training: experience deep dive + per-question review.

The frontend follows the backend stage configuration. If visible stage transitions are enabled, the candidate sees short transition prompts. If disabled, the session runs more continuously and immersively.

### 5.5 AI Coaching Review

After the session, AI generates:

- Overall score.
- Sub-scores.
- Per-question feedback.
- Expression and delivery analysis.
- Answer quality analysis.
- Interview strategy suggestions.
- Weak-point tags.
- Next training plan.

The service backend sees the complete report. The candidate sees a simplified, actionable version.

## 6. Interviewer Template System

The first version should support diverse interviewer templates. These are persona and scenario configurations, not necessarily different digital human video assets.

MVP interviewer types:

1. Warm and guiding interviewer.
2. Standard HR interviewer.
3. Business manager interviewer.
4. Technical or professional interviewer.
5. Pressure interviewer.
6. Experience deep-dive interviewer.
7. Case analysis interviewer.
8. Executive final-round interviewer.
9. Cross-cultural or foreign-company English interviewer.
10. Cold or low-feedback interviewer.

Each interviewer template can configure:

- Tone.
- Question style.
- Follow-up depth.
- Interrupt frequency.
- Challenge intensity.
- Language.
- Chinese-English ratio.
- Suitable stages.
- Suitable company or job templates.
- Safety boundaries.

The backend can select one primary interviewer template or assemble an interviewer group, such as:

- HR screening + business manager + pressure follow-up.
- Technical interviewer + experience deep dive + executive final round.
- English HR + hiring manager + panel interview.

Pressure mode must have boundaries. It can challenge, interrupt, and question the candidate, but it should not insult or humiliate them. The candidate can pause or exit pressure stages, and the backend can limit intensity.

## 7. Service Backend Modules

### 7.1 Candidate Profiles

Manage:

- Candidate identity.
- Contact information.
- Target company.
- Target role.
- Service status.
- Weak-point tags.
- Training history.
- Historical progress summary.

### 7.2 Material Assets

Manage:

- Resumes.
- Job descriptions.
- Supplementary materials.
- Target company information.
- Company templates.
- Job templates.

Each asset should record source, upload time, owner, and related training tasks.

### 7.3 Company and Job Template Library

Templates include:

- Company interview style.
- Industry context.
- Role competency model.
- Common questions.
- Follow-up patterns.
- Scoring standard.
- Risk questions.
- Restricted topics.

The MVP can start with lightweight templates. Coverage can expand gradually as the service provider handles more candidates.

### 7.4 Interviewer Template Library

Manage interviewer types, tone, intensity, language, stage suitability, and behavior constraints.

### 7.5 Training Task Creation

The service provider selects:

- Candidate.
- Target company.
- Target role.
- Materials.
- Company and job templates.
- Interviewer type or interviewer group.
- Training stage configuration.
- Expected duration.

The system generates:

- Training outline.
- Practice link.
- Session configuration.

### 7.6 Training Records

The backend can view:

- Audio or video record, depending on enabled capture.
- Transcript.
- Stage timeline.
- Question list.
- Candidate answers.
- AI follow-ups.
- Long silence events.
- Off-topic events.
- Speech recognition errors.
- Service degradation events.

### 7.7 AI Coaching Report Center

The backend can view:

- Overall score.
- Sub-scores.
- Per-question feedback.
- Expression and delivery analysis.
- Answer quality analysis.
- Interview strategy suggestions.
- Weak-point trends.
- Next training plan.
- Candidate-facing report version.

## 8. Candidate Practice Modules

### 8.1 Practice Entry Page

Shows the session summary, device checks, privacy notice, and start action.

### 8.2 Digital Human Interview Room

Supports real-time interview practice with digital human presence, voice, transcript, timers, and session controls.

### 8.3 Stage-Aware Experience

The frontend follows the configured training stages. Stage visibility can be on or off.

### 8.4 Candidate Report

Shows:

- Overall performance.
- Top 3 improvement areas.
- Per-question suggestions.
- Example answer direction.
- Next recommended practice.

### 8.5 Retraining Entry

The report page can lead to targeted retraining, such as:

- Practice self-introduction again.
- Retry project deep dive.
- Enter pressure follow-up.
- Practice English answer delivery.

## 9. AI Orchestration

The platform should use a unified AI orchestration layer to avoid vendor lock-in.

### 9.1 AI Capability Modules

1. Material parsing AI.
2. Training outline generation AI.
3. Real-time interviewer AI.
4. Speech and digital human services.
5. Real-time state analysis AI.
6. Review and scoring AI.
7. AI coach planning AI.

### 9.2 Provider Strategy

Different providers can be used for different tasks:

- Low-latency model for real-time interviewing.
- Strong reasoning model for report generation.
- Specialized speech provider for speech recognition and text-to-speech.
- Digital human provider for avatar/video generation.
- Backup providers for failover.

The backend should expose capability-level configuration instead of hardcoding vendor names into product logic.

### 9.3 Data Flow

1. Service provider creates candidate profile and training task.
2. Service provider uploads or selects resume, job description, company template, and job template.
3. Material parsing AI extracts experience, ability points, risk points, job requirements, and follow-up material.
4. Training outline generation AI creates session structure.
5. Candidate enters practice link.
6. Real-time interviewer AI conducts the interview through voice and digital human services.
7. Transcript and state signals are captured during the session.
8. Review and scoring AI generates the report.
9. AI coach planning AI generates the next training plan.
10. Records are saved to the candidate profile for future tracking.

## 10. Data Model

The MVP should include these data groups:

1. Candidate profile.
2. Material asset.
3. Company template.
4. Job template.
5. Interviewer template.
6. Training task.
7. Training session.
8. Coaching report.
9. AI service call log.

AI service call logs should record:

- Capability used.
- Provider used.
- Request time.
- Latency.
- Cost estimate.
- Success or failure.
- Failure reason.
- Fallback provider, if used.

This is important for cost control, quality tracking, and debugging.

## 11. Privacy and Data Governance

The MVP uses service-provider-managed data.

The product must clearly tell candidates that submitted materials may be used for:

- Interview training.
- AI analysis.
- Report generation.
- Service delivery.
- Historical progress tracking.

The backend should record access, export, delete, and major report operations. Later versions can add more granular retention policies and candidate self-service deletion controls.

## 12. Error Handling and Degradation

The interview experience should remain usable when individual AI or media capabilities fail.

Required handling:

- Long silence: digital human gives a warm reminder or switches to hint mode.
- Off-topic answer: interviewer asks one clarifying follow-up and records answer drift.
- Speech recognition failure: candidate can repeat or switch to text input.
- AI provider failure: orchestration layer switches to backup provider when available.
- Digital human video failure: degrade to avatar plus voice.
- Voice service failure: degrade to text interview mode if needed.
- Pressure mode too strong: candidate can pause or exit pressure stage.
- Session interruption: save completed parts and allow resume or partial report generation.

## 13. MVP Scope

Included:

- Service backend.
- Candidate profiles.
- Material upload and management.
- Company and job templates.
- Interviewer templates and interviewer groups.
- Training task creation.
- Practice link generation.
- Candidate practice entry.
- Digital human interview room.
- Real-time voice conversation.
- Transcript capture.
- Configurable training stages.
- AI-generated report.
- Next training plan.
- Historical training records.
- AI service call records.

Not included in MVP:

- Fully realistic human-level digital human video.
- Native mobile app.
- Large-scale question marketplace.
- Complex multi-tenant SaaS permissions.
- Real-time human coach intervention.
- Deep video-based facial expression or posture analysis.
- Payment, contract, and invoice systems.

## 14. Testing and Acceptance Criteria

The MVP is acceptable when:

- A service provider can create a training task and generate a practice link within 5 minutes.
- A candidate can complete a 15-30 minute interview session in a browser.
- The system can generate a usable transcript.
- The system can generate overall scoring, sub-scores, per-question feedback, weak-point tags, and next training plan.
- Stage switches affect the actual interview flow.
- Interviewer templates affect tone, question style, follow-up depth, and pressure level.
- Company and job templates affect question selection and scoring.
- AI provider failures produce a fallback or clear degradation state.
- The backend can track each candidate's weak points and progress across sessions.

## 15. Future Expansion

Phase 2:

- Higher-fidelity digital human video.
- Larger company and job template library.
- English and multilingual training.
- AI-generated example answers.
- Automated retraining plans.
- Management role and executive final-round modules.
- Multi-coach backend permissions.
- Video-based expression and posture analysis.

Phase 3:

- Native mobile app.
- Course-style training packages.
- Real interview recap import.
- Payment and commercial service system.
- Enterprise, school, or training-institution SaaS edition.

## 16. Open Implementation Notes

- Start with a web-first responsive product.
- Keep AI providers behind capability adapters.
- Store full backend reports and simplified candidate reports separately.
- Treat interviewer diversity as template behavior first, video asset diversity later.
- Keep training stages configurable from the beginning, because service scenarios vary widely.
- Measure both training completion and improvement over repeated sessions.
