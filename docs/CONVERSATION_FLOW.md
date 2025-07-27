# Conversation Flow and Function Handling

This document describes the complete conversation flow and function handling architecture of Chimp-GPT, featuring the modern PocketFlow system alongside legacy conversation management.

## Architecture Overview

Chimp-GPT uses a dual-system architecture:
- **PocketFlow System**: Modern graph-based conversation management (v2.0+)
- **Legacy System**: Traditional conversation handling (v1.x compatibility)

## PocketFlow Architecture (Primary)

```mermaid
flowchart TD
    A[Discord Message Event] --> B{Bot Message?}
    B -->|Yes| C[Ignore]
    B -->|No| D{Authorized Channel?}
    D -->|No| C
    D -->|Yes| E[PocketFlow Manager]
    
    E --> F[Intent Detection Node]
    F --> G[Context Manager Node]
    G --> H[Response Router Node]
    H --> I{Flow Type?}
    
    I -->|Individual| J[Individual Flow]
    I -->|Blended| K[Blended Flow]
    I -->|Command| L[Command Flow]
    
    J --> M[Function Executor Node]
    K --> M
    L --> N[Direct Command Execution]
    
    M --> O{Function Call?}
    O -->|Yes| P[Execute Function]
    O -->|No| Q[Direct Response]
    
    P --> R[Natural Response Generation]
    Q --> R
    N --> R
    
    R --> S[Update Message]
    S --> T[Save to Conversation Store]
    T --> U[Update Bot Status]
```

## Legacy Flow (Compatibility Mode)

```mermaid
flowchart TD
    A[Discord Message Event] --> B{PocketFlow Enabled?}
    B -->|No| C[Legacy Message Processing]
    B -->|Yes| D[PocketFlow Processing]
    
    C --> E[Plugin Processing]
    E --> F{Is Command?}
    F -->|Yes| G[Execute Command]
    F -->|No| H{Rate Limited?}
    
    H -->|Yes| I[Update with Rate Limit]
    H -->|No| J[Load Conversation]
    
    J --> K[Send to OpenAI]
    K --> L{Function Call?}
    L -->|Yes| M[Execute Function]
    L -->|No| N[Direct Response]
    
    M --> O[Generate Natural Response]
    O --> P[Update Message]
    N --> P
    G --> P
    I --> P
    
    P --> Q[Save Conversation]
    Q --> R[Update Bot Status]
```

## Detailed Function Calling Flow

```mermaid
flowchart TD
    A[OpenAI Returns Function Call] --> B{Which Function?}
    
    B -->|weather| C[Weather Lookup]
    B -->|time| D[Time Lookup]
    B -->|wolfram| E[Wolfram Query]
    B -->|quake| F[Quake Stats]
    B -->|create_image| G[Image Generation]
    
    C --> H[Apply Rate Limits]
    D --> H
    E --> H
    F --> H
    G --> H
    
    H --> I{Rate Limited?}
    I -->|Yes| J[Return Error]
    I -->|No| K[Execute API Call]
    
    K --> L{Circuit Breaker Open?}
    L -->|Yes| M[Return Cached/Error]
    L -->|No| N[Make Request]
    
    N --> O{Success?}
    O -->|No| P[Update Circuit State]
    O -->|Yes| Q[Process Results]
    
    P --> R[Retry Logic]
    R --> N
    
    Q --> S[Format Results]
    S --> T[Send to OpenAI]
    T --> U[Generate Natural Response]
```

## PocketFlow Conversation Management

```mermaid
flowchart TD
    A[New Message] --> B[PocketFlow Manager]
    B --> C[Intent Detection Node]
    C --> D[Context Manager Node]
    D --> E{Conversation Exists?}
    E -->|No| F[Create New Flow]
    E -->|Yes| G[Load from Store]
    
    F --> H[Initialize Shared Store]
    G --> I[Update Context]
    H --> I
    
    I --> J[Response Router Node]
    J --> K{Flow Selection}
    K -->|Individual| L[User-Specific Context]
    K -->|Blended| M[Channel-Wide Context]
    K -->|Command| N[Direct Execution]
    
    L --> O[Function Executor Node]
    M --> O
    N --> P[Command Response]
    
    O --> Q{Function Call?}
    Q -->|Yes| R[Execute API Function]
    Q -->|No| S[Direct AI Response]
    
    R --> T[Natural Response Generation]
    S --> T
    P --> T
    
    T --> U[Save to Store]
    U --> V[Cleanup Old Flows]
```

## Legacy Conversation Management

```mermaid
flowchart TD
    A[New Message] --> B[Load Conversation]
    B --> C{Exists in Memory?}
    C -->|No| D[Load from Disk]
    C -->|Yes| E[Get from Map]
    
    D --> F{File Exists?}
    F -->|No| G[Create New]
    F -->|Yes| H[Parse JSON]
    
    G --> I[Add System Message]
    H --> I
    E --> I
    
    I --> J{Has Reply Reference?}
    J -->|Yes| K[Fetch Referenced Messages]
    J -->|No| L[Add Current Message]
    
    K --> M[Build Context Chain]
    M --> L
    
    L --> N{Over Token Limit?}
    N -->|Yes| O[Optimize Conversation]
    N -->|No| P[Continue]
    
    O --> Q[Remove Old Messages]
    Q --> P
    
    P --> R[Add to Conversation]
    R --> S[Save to Memory]
    S --> T[Schedule Disk Save]
```

## Command Processing Flow

```mermaid
flowchart TD
    A[Message with Prefix] --> B[Parse Command]
    B --> C{Valid Command?}
    C -->|No| D[Ignore]
    C -->|Yes| E{Check Permissions}
    
    E --> F{Owner Only?}
    F -->|Yes| G{Is Owner?}
    F -->|No| H{Admin Only?}
    
    G -->|No| I[Permission Denied]
    G -->|Yes| J[Continue]
    
    H -->|Yes| K{Has Admin?}
    H -->|No| J
    
    K -->|No| I
    K -->|Yes| J
    
    J --> L{Needs Approval?}
    L -->|Yes| M[Request Approval]
    L -->|No| N[Execute Command]
    
    M --> O[Wait for Reaction]
    O --> P{Approved?}
    P -->|No| Q[Cancel]
    P -->|Yes| N
    
    N --> R[Run Command Handler]
    R --> S[Send Response]
```

## Plugin System Flow

```mermaid
flowchart TD
    A[Bot Start] --> B[Load Plugins]
    B --> C[For Each Plugin]
    C --> D[Call Initialize]
    D --> E[Register Commands]
    E --> F[Register Hooks]
    
    G[Message Event] --> H{Plugin Enabled?}
    H -->|No| I[Skip Plugin]
    H -->|Yes| J[beforeCommand Hook]
    
    J --> K[Process Message]
    K --> L[afterCommand Hook]
    L --> M[onMessage Hook]
    
    N[Command Execution] --> O{Is Plugin Command?}
    O -->|Yes| P[Execute Plugin Command]
    O -->|No| Q[Execute Core Command]
```

## Error Handling Flow

```mermaid
flowchart TD
    A[Error Occurs] --> B{Error Type?}
    
    B -->|API Error| C[ApiError Handler]
    B -->|Discord Error| D[DiscordError Handler]
    B -->|Config Error| E[ConfigError Handler]
    B -->|Plugin Error| F[PluginError Handler]
    B -->|Other| G[Generic Handler]
    
    C --> H[Log Error]
    D --> H
    E --> H
    F --> H
    G --> H
    
    H --> I{User Facing?}
    I -->|Yes| J[Send User Message]
    I -->|No| K[Log Only]
    
    J --> L[Update Metrics]
    K --> L
    
    L --> M{Critical?}
    M -->|Yes| N[Alert Owner]
    M -->|No| O[Continue]
```

## Key Components

### PocketFlow System (v2.0+)

#### **1. PocketFlow Manager** (`PocketFlowConversationManager.js`)
- Orchestrates all conversation flows
- Manages A/B testing with legacy system
- Handles concurrent flow limitations
- Provides comprehensive metrics

#### **2. Core Nodes** (`flow/nodes/`)
- **Intent Detection Node**: Analyzes message intent with confidence scoring
- **Context Manager Node**: Optimizes conversation context and token usage
- **Response Router Node**: Intelligently routes between flow types
- **Function Executor Node**: Handles OpenAI function calling workflow

#### **3. Flow Types** (`flow/flows/`)
- **Individual Flow**: One-on-one user conversations
- **Blended Flow**: Multi-user channel conversations
- **Command Flow**: Direct command execution

#### **4. Shared Store** (`ConversationStore.js`)
- Graph-based state management
- Real-time conversation analytics
- Automatic cleanup and memory management

### Legacy System (v1.x Compatibility)

#### **1. Message Reception** (`chimpGPT.js`)
- Handles Discord `messageCreate` events
- Validates messages (not bot, not DM, authorized channel)
- Provides immediate user feedback

#### **2. Conversation Manager** (`conversationManager.js`)
- Maintains conversation history in memory and disk
- Handles message references and reply chains
- Implements automatic pruning and optimization

#### **3. Function Handler** (`chimpGPT.js:handleFunctionCall`)
- Processes OpenAI function calls
- Applies rate limiting and circuit breaking
- Formats results for natural language generation

### Shared Components

#### **1. Command Handler** (`commandHandler.js`)
- Parses and validates commands
- Checks permissions and approval requirements
- Routes to appropriate command modules

#### **2. Plugin Manager** (`pluginManager.js`)
- Loads and initializes plugins
- Manages plugin hooks and commands
- Handles plugin errors gracefully

#### **3. Circuit Breaker** (`circuitBreaker.js`)
- Protects external API calls
- Implements retry logic with exponential backoff
- Maintains circuit states across restarts

#### **4. Human Circuit Breaker** (`humanCircuitBreaker.js`)
- Requires Discord reaction approval for sensitive operations
- Implements timeout and cancellation
- Logs approval/rejection decisions

## Performance Optimizations

### PocketFlow Optimizations
1. **Graph-Based Processing**: 60% reduction in conversation logic complexity
2. **Intent-Driven Routing**: Smart flow selection based on message analysis
3. **Dynamic Context Management**: Intelligent token optimization
4. **Parallel Flow Processing**: Concurrent conversation handling
5. **Real-Time Analytics**: Performance monitoring and metrics
6. **Automatic Cleanup**: Memory management with configurable retention

### Legacy Optimizations
1. **Immediate Feedback**: Shows "Thinking..." message instantly
2. **Async Plugin Processing**: Plugins run in parallel
3. **Rate Limiting**: Prevents API abuse and manages costs
4. **Circuit Breaking**: Fails fast when services are down
5. **Conversation Optimization**: Prunes old messages to stay within token limits
6. **Caching**: Circuit breaker caches successful responses
7. **Batched Saves**: Conversations saved every 5 minutes instead of per-message

### Shared Optimizations
8. **A/B Testing**: Compare system performance in real-time
9. **Intelligent Fallbacks**: Graceful degradation when services fail
10. **Resource Management**: Configurable limits and monitoring

## Data Flow Summary

```
User Message → Discord API → Bot Client
    ↓
Validation & Initial Feedback
    ↓
Plugin Processing (async)
    ↓
Command Check → Execute Command → Response
    OR ↓
Rate Limit Check
    ↓
Load/Update Conversation Context
    ↓
Send to OpenAI API
    ↓
Function Call → Execute Function → Natural Response
    OR ↓
Direct AI Response
    ↓
Update Conversation History
    ↓
Send Final Response → Update Bot Status
```

This architecture ensures reliable, performant, and maintainable bot operations with clear separation of concerns and comprehensive error handling throughout the flow.