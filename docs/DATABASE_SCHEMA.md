# RocketMap Database Schema (Finalized)

This document reflects the high-performance relationship-driven schema for RocketMap. All tables now use formal Appwrite Relationships with Cascade Deletes.

## Core Design Principles

1.  **No Manual Joins**: Use Appwrite's nested document fetching.
2.  **Referential Integrity**: All child data (Blocks, Segments, Messages, Assumptions, Experiments) is automatically deleted if the parent Canvas or related entity is deleted.
3.  **String IDs Only**: Standard Appwrite internal IDs ($id) are used for all links. Custom integer ID columns have been removed.

## Collections

### 1. `users`

Stores user profile information.

- **$id**: String (Primary Key)
- **email**: String (Email format, Required)
- **name**: Text
- **onboardingCompleted**: Boolean (Default: false)
- **canvases**: Relationship (Many-to-One with `canvases`, Two-Way, Key: `user`, Restrict)
- **messages**: Relationship (Many-to-One with `messages`, Two-Way, Key: `user`, Cascade Delete)

### 2. `canvases`

The root container for a Business Model Canvas or Lean Canvas.

- **$id**: String (Primary Key)
- **slug**: VarChar(256) (Required, Indexed) - _Used for URL routing_
- **title**: String(256) (Required)
- **description**: String(1000) (Default: '')
- **isPublic**: Boolean (Required)
- **viabilityScore**: Double (0-100)
- **viabilityDataJson**: LongText - _Detailed breakdown of canvas viability_
- **viabilityCalculatedAt**: DateTime
- **createdAt**: DateTime (Required)
- **updatedAt**: DateTime (Required)
- **user**: Relationship (Many-to-One with `users`, Two-Way, Restrict)
- **blocks**: Relationship (One-to-Many with `blocks`, Cascade Delete)
- **segments**: Relationship (One-to-Many with `segments`, Cascade Delete)
- **messages**: Relationship (One-to-Many with `messages`, Cascade Delete)
- **assumptions**: Relationship (One-to-Many with `assumptions`, Cascade Delete)

### 3. `blocks`

Individual building blocks (Value Prop, Customer Segments, etc.)

- **$id**: String
- **blockType**: Enum (customer_segments, value_prop, channels, customer_relationships, revenue_streams, key_resources, key_activities, key_partnerships, cost_structure, problem, solution, key_metrics, unfair_advantage) (Required, Indexed)
- **contentJson**: LongText (BMC/Lean textual content)
- **aiAnalysisJson**: LongText
- **deepDiveJson**: LongText (Layer 2 research data)
- **confidenceScore**: Double (0-1)
- **riskScore**: Double (0-1)
- **canvas**: Relationship (Many-to-One with `canvases`, Two-Way, Cascade Delete)
- **segments**: Relationship (Many-to-Many with `segments`, Two-Way, Cascade Delete)
- **assumptions**: Relationship (Many-to-Many with `assumptions`, Two-Way, Cascade Delete)

### 4. `segments`

Customer segments defined for a canvas.

- **$id**: String
- **name**: String(256) (Required)
- **description**: String(5000) (Default: '')
- **earlyAdopterFlag**: Boolean (Default: false)
- **priorityScore**: Integer (0-100, Default: 50)
- **colorHex**: VarChar(7)
- **demographics**: VarChar(500)
- **psychographics**: VarChar(500)
- **behavioral**: VarChar(500)
- **geographic**: VarChar(500)
- **estimatedSize**: VarChar(100)
- **canvas**: Relationship (Many-to-One with `canvases`, Two-Way, Cascade Delete)
- **blocks**: Relationship (Many-to-Many with `blocks`, Two-Way, Cascade Delete)

### 5. `assumptions`

Risks and assumptions identified for blocks or the canvas.

- **$id**: String
- **assumptionText**: String(512) (Required)
- **category**: Enum (market, product, ops, legal) (Required, Indexed)
- **status**: Enum (untested, testing, validated, inconclusive, refuted) (Required, Indexed)
- **riskLevel**: Enum (high, medium, low) (Indexed)
- **severityScore**: Double (0-10, Required)
- **confidenceScore**: Double (0-100)
- **source**: Enum (ai, user) (Indexed)
- **segmentIds**: String(1000) (JSON array)
- **linkedValidationItemIds**: String(1000) (JSON array)
- **suggestedExperiment**: String (Legacy, now handled by Relationship)
- **suggestedExperimentDuration**: VarChar(100)
- **decisionSignal**: Enum (kill, pivot, double_down, insufficient_evidence) (Optional)
- **createdAt**: DateTime
- **updatedAt**: DateTime
- **lastTestedAt**: DateTime
- **canvas**: Relationship (Many-to-One with `canvases`, Two-Way, Cascade Delete)
- **blocks**: Relationship (Many-to-Many with `blocks`, Two-Way, Cascade Delete)

### 6. `messages`

Chat history for AI-driven analysis.

- **$id**: String
- **chatKey**: String(64) (Required)
- **role**: String(16) (Required, user/assistant)
- **content**: String(100000) (Required)
- **messageId**: String(64) (Required)
- **createdAt**: String(30) (Required, ISO timestamp)
- **user**: Relationship (Many-to-One with `users`, Two-Way, Cascade Delete)
- **canvas**: Relationship (Many-to-One with `canvases`, Two-Way, Cascade Delete)

### 7. `experiments`

Validation experiments conducted for specific assumptions.

- **$id**: String
- **assumption**: Relationship (Many-to-One with `assumptions`, One-Way, Cascade Delete)
- **type**: Enum (survey, interview, mvp, ab_test, research, other) (Required)
- **description**: LongText (Required)
- **successCriteria**: String(500) (Required)
- **successThreshold**: String(500) (Optional)
- **status**: Enum (planned, running, completed) (Default: planned)
- **result**: Enum (supports, contradicts, mixed, inconclusive)
- **evidence**: LongText (Default: '')
- **sourceUrl**: String(500)
- **costEstimate**: String(50)
- **durationEstimate**: String(50)
- **createdAt**: DateTime
- **completedAt**: DateTime
