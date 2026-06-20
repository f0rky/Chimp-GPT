# PocketFlow Architecture Documentation

## Overview

PocketFlow is a graph-based conversation management system that provides a modular, maintainable, and efficient approach to handling Discord bot conversations. This document details the internal architecture, data flows, and implementation patterns.

**Version**: 2.1.6
**Philosophy**: KISS (Keep It Simple, Stupid) - Simple nodes, clear connections, minimal complexity

## Core Principles

### 1. Graph-Based Architecture
- Conversations flow through connected nodes
- Each node has a single responsibility
- Nodes connect with conditional logic
- Clear data flow from start to finish

### 2. Shared State Management
- Centralized `SharedStore` for all conversation data
- Map-based storage for O(1) lookups
- Automatic cleanup and memory management
- No filesystem dependencies during runtime

### 3. Modular Design
- Each node is independently testable
- Nodes can be composed in different ways
- Easy to add new functionality
- Clear separation of concerns

---

## Core Components

### PocketFlow Base Classes

```mermaid
graph TD
    A[Node] --> B[BaseConversationNode]
    C[Flow] --> D[IndividualConversationFlow]
    C --> E[BlendedConversationFlow]
    C --> F[CommandFlow]
    G[SharedStore] --> H[ConversationStore]

    B --> I[IntentDetectionNode]
    B --> J[ContextManagerNode]
    B --> K[ResponseRouterNode]
    B --> L[FunctionExecutorNode]
    B --> M[ImageGenerationAgentNode]

    style A fill:#e1f5ff
    style C fill:#e1f5ff
    style G fill:#e1f5ff
    style B fill:#fff4e1
    style H fill:#fff4e1
```

### Node → Flow → Store Relationship

```mermaid
classDiagram
    class Node {
        +String id
        +Function action
        +Array connections
        +connect(node, condition)
        +execute(store, data)
    }

    class Flow {
        +Node startNode
        +SharedStore store
        +run(initialData)
        +getStore()
    }

    class SharedStore {
        +Map data
        +set(key, value)
        +get(key)
        +has(key)
        +delete(key)
        +clear()
        +getAll()
    }

    Flow --> Node : contains
    Flow --> SharedStore : uses
    Node --> SharedStore : reads/writes
    Node --> Node : connects to
```

---

## Node Execution Flow

### Basic Node Execution with Error Handling

```mermaid
sequenceDiagram
    participant Flow
    participant Node
    participant Action
    participant Store
    participant Connection

    Flow->>Node: execute(store, data)

    rect rgb(240, 248, 255)
        Note over Node: SafeExecute Wrapper
        Node->>Node: Start timeout timer
        Node->>Action: action(store, data)
        Action->>Store: get/set data
        Store-->>Action: state data
        Action-->>Node: result
        Node->>Node: Clear timeout
    end

    alt Success
        Node->>Connection: check condition(result, store)
        Connection-->>Node: condition met
        Node->>Connection: connection.node.execute(store, result)
        Connection-->>Node: connected result
        Node-->>Flow: final result
    else Timeout
        Node->>Node: handleError
        Node->>Node: retry logic (if retries > 0)
        Node-->>Flow: error result
    else Error
        Node->>Node: logError
        Node->>Node: retry or handleError
        Node-->>Flow: error result
    end
```

### Node Connection Patterns

```mermaid
flowchart TD
    A[Node A] -->|onSuccess| B[Node B]
    A -->|onError| C[Error Handler]
    A -->|onCondition: intent > 0.8| D[High Confidence Path]
    A -->|onCondition: intent < 0.5| E[Low Confidence Path]

    B --> F[Next Node]
    D --> F
    E --> G[Alternative Path]

    style A fill:#e1f5ff
    style B fill:#e8f5e9
    style C fill:#ffebee
    style D fill:#fff4e1
    style E fill:#fff4e1
```

---

## Individual Conversation Flow (Detailed)

### Complete Flow Path

```mermaid
flowchart TD
    A[Discord Message] --> B[PocketFlowConversationManager]
    B --> C[determineFlowType]
    C --> D{Flow Type?}

    D -->|individual| E[IndividualConversationFlow]
    D -->|blended| F[BlendedConversationFlow]
    D -->|command| G[CommandFlow]

    E --> H[IntentDetectionNode]

    H --> I[Pattern Matching]
    I --> J{Confidence Calculation}
    J --> K[Store Intent]
    K --> L[ContextManagerNode]

    L --> M{Conversation Type?}
    M -->|individual| N[Build Individual Context]
    M -->|blended| O[Build Blended Context]

    N --> P[Get User Conversation from Store]
    O --> Q[Get Channel Context from Store]

    P --> R[Optimize Context for Tokens]
    Q --> R

    R --> S{Over Token Limit?}
    S -->|Yes| T[Remove Old Messages]
    S -->|No| U[Keep All Messages]

    T --> V[Update Store]
    U --> V

    V --> W[ResponseRouterNode]

    W --> X{Routing Decision}
    X -->|Individual| Y[Set conversationType: individual]
    X -->|Blended| Z[Set conversationType: blended]

    Y --> AA[FunctionExecutorNode]
    Z --> AA

    AA --> AB[Send to OpenAI with Functions]
    AB --> AC{Response Type?}

    AC -->|Function Call| AD[Execute Function]
    AC -->|Direct Response| AE[Direct AI Response]

    AD --> AF{Which Function?}
    AF -->|Image| AG[ImageGenerationFlow]
    AF -->|Time| AH[lookupTime]
    AF -->|Weather| AI[lookupWeather]
    AF -->|Other| AJ[Execute via Processor]

    AG --> AK[Stream Progress Updates]
    AK --> AL[Generate Image]
    AL --> AM[Return Image Data]

    AH --> AN[Return Time Data]
    AI --> AN
    AJ --> AN

    AM --> AO[Send Result to OpenAI]
    AN --> AO
    AE --> AP[Format Response]

    AO --> AQ[Generate Natural Response]
    AQ --> AP

    AP --> AR[Update Conversation Store]
    AR --> AS[Return Response to Manager]
    AS --> AT[Send Discord Message]

    style H fill:#e1f5ff
    style L fill:#e1f5ff
    style W fill:#e1f5ff
    style AA fill:#e1f5ff
    style AG fill:#fff4e1
```

---

## Intent Detection Node

### Pattern Matching and Confidence Scoring

```mermaid
flowchart TD
    A[Message Content] --> B[IntentDetectionNode]
    B --> C[Initialize confidence = 0]

    C --> D{Discord Mention?}
    D -->|Yes| E[confidence = 1.0<br/>DONE]
    D -->|No| F{Command Prefix?}

    F -->|Yes /! prefix| G[confidence = 0.8<br/>DONE]
    F -->|No| H[Check High Confidence Patterns]

    H --> I{Matches Image/Weather/Time?}
    I -->|Yes| J[confidence += 0.7]
    I -->|No| K[confidence += 0.0]

    J --> L[Check Bot Directed Patterns]
    K --> L

    L --> M{Matches Bot Name?}
    M -->|Yes| N[confidence += 0.3]
    M -->|No| O{Question Mark?}

    O -->|Yes| P[confidence += 0.5]
    O -->|No| Q[confidence += 0.0]

    N --> R{Reply to Bot?}
    P --> R
    Q --> R

    R -->|Yes| S[confidence += 0.3]
    R -->|No| T[Continue]

    S --> U{Message Length?}
    T --> U

    U -->|< 3 chars| V[confidence *= 0.3]
    U -->|>= 3 chars| W[Keep confidence]

    V --> X[Clamp to max 1.0]
    W --> X

    X --> Y{confidence > 0.4?}
    Y -->|Yes| Z[isBotDirected = true]
    Y -->|No| AA[isBotDirected = false]

    Z --> AB[Store Intent in SharedStore]
    AA --> AB

    AB --> AC[Pass to ContextManager]

    E --> AC
    G --> AC

    style B fill:#e1f5ff
    style E fill:#c8e6c9
    style G fill:#c8e6c9
    style Z fill:#c8e6c9
    style AA fill:#ffcdd2
```

### Intent Detection Patterns

| Pattern Type | Examples | Confidence Boost |
|-------------|----------|------------------|
| Discord Mention | `@BotName` | 1.0 (absolute) |
| Command Prefix | `/help`, `!status` | 0.8 |
| High Confidence | "draw an image", "what's the weather" | +0.7 |
| Bot Directed | "chimp", "bot", "hey bot" | +0.3 |
| Questions | Ends with `?` | +0.5 |
| Reply to Bot | Message is reply to bot message | +0.3 |
| Short Messages | < 3 characters | ×0.3 (penalty) |

---

## Context Manager Node

### Context Optimization Flow

```mermaid
flowchart TD
    A[ContextManagerNode] --> B{Conversation Type?}

    B -->|Individual| C[buildIndividualContext]
    B -->|Blended| D[buildBlendedContext]

    C --> E[Get User Conversation from Store]
    E --> F[Create System Message with Personality]
    F --> G{User Has Location Preference?}
    G -->|Yes| H[Add Location to System Prompt]
    G -->|No| I[Standard System Prompt]

    H --> J[Add Current User Message]
    I --> J

    J --> K[Append to conversation.messages]
    K --> L{messages.length > maxConversationLength?}
    L -->|Yes| M[Slice to keep last N messages]
    L -->|No| N[Keep all messages]

    M --> O[Update Store]
    N --> O

    O --> P[Prepare messages array]

    D --> Q[Get Channel Context from Store]
    Q --> R[Create System Message]
    R --> S[Format with username prefix]
    S --> T[Append to channelContext.recentMessages]
    T --> U{messages > maxConversationLength?}
    U -->|Yes| V[Slice to keep last N]
    U -->|No| W[Keep all]

    V --> X[Update Channel Context]
    W --> X
    X --> P

    P --> Y[optimizeContext]
    Y --> Z[estimateTokenCount for all messages]
    Z --> AA{totalTokens > maxTokens?}

    AA -->|Yes| AB[Token Optimization Required]
    AA -->|No| AC[No Optimization Needed]

    AB --> AD[Preserve System Message]
    AD --> AE[Preserve Last N User Messages]
    AE --> AF[Remove Oldest Messages]
    AF --> AG[Re-calculate token count]
    AG --> AH{Still over limit?}

    AH -->|Yes| AI[Emergency Mode: Use emergencyMaxTokens]
    AH -->|No| AJ[Optimization Complete]

    AI --> AK[More aggressive pruning]
    AK --> AJ

    AC --> AL[Return Original Messages]
    AJ --> AM[Return Optimized Messages]

    AL --> AN[Update Conversation Store with Metadata]
    AM --> AN

    AN --> AO[Pass to ResponseRouter]

    style A fill:#e1f5ff
    style Y fill:#fff4e1
    style AB fill:#ffe0b2
    style AI fill:#ffcdd2
```

### Token Optimization Strategy

```mermaid
graph TD
    A[Message Array] --> B{Token Count?}
    B -->|< maxTokens| C[✅ No Optimization]
    B -->|> maxTokens| D[🔧 Start Optimization]

    D --> E[Always Preserve]
    E --> F[System Message]
    E --> G[Last 3 User Messages]

    D --> H[Remove Oldest First]
    H --> I[Calculate New Token Count]
    I --> J{Under Limit?}
    J -->|No| H
    J -->|Yes| K[✅ Optimization Complete]

    I --> L{Extreme Case?}
    L -->|All removed, still over| M[🚨 Emergency Mode]
    M --> N[Use emergencyMaxTokens]
    M --> O[Truncate Individual Messages]

    C --> P[Return Messages]
    K --> P
    N --> P

    style F fill:#c8e6c9
    style G fill:#c8e6c9
    style M fill:#ffcdd2
```

---

## Response Router Node

### Intelligent Flow Selection

```mermaid
flowchart TD
    A[ResponseRouterNode] --> B[Get message, intent, context]

    B --> C{Is Direct Message?}
    C -->|Yes| D[Route: Individual<br/>Reason: direct_message<br/>Confidence: 1.0]

    C -->|No| E{Intent Confidence?}
    E -->|>= 0.8| F[Route: Individual<br/>Reason: high_confidence_intent]
    E -->|< 0.8| G{Is Command Message?}

    G -->|Yes /! prefix| H[Route: Individual<br/>Reason: command_message<br/>Confidence: 1.0]
    G -->|No| I[analyzeChannelActivity]

    I --> J{Active Users >= 5?}
    J -->|Yes| K[Route: Blended<br/>Reason: high_channel_activity<br/>Confidence: 0.7]
    J -->|No| L{Recent Channel Conversation?}

    L -->|Yes < 5 min| M[Route: Blended<br/>Reason: ongoing_channel_conversation<br/>Confidence: 0.6]
    L -->|No| N{Intent Confidence?}

    N -->|>= 0.5| O[Route: Individual<br/>Reason: moderate_confidence_intent]
    N -->|< 0.5| P[Route: Individual (Default)<br/>Reason: default_fallback<br/>Confidence: 0.3]

    D --> Q[updateRoutingMetrics]
    F --> Q
    H --> Q
    K --> Q
    M --> Q
    O --> Q
    P --> Q

    Q --> R[Store routing decision in Store]
    R --> S[Pass to FunctionExecutor]

    style D fill:#c8e6c9
    style F fill:#c8e6c9
    style H fill:#c8e6c9
    style K fill:#fff9c4
    style M fill:#fff9c4
    style O fill:#e1f5ff
    style P fill:#ffccbc
```

### Channel Activity Analysis

```mermaid
flowchart LR
    A[Channel Context] --> B[Get recentMessages]
    B --> C[Filter: last 5 minutes]
    C --> D[Count Unique Users]
    C --> E[Count Total Messages]
    C --> F[Calculate Time Between Messages]

    D --> G{uniqueUsers >= 5?}
    E --> H{messageCount > 10?}
    F --> I{avgTime < 30s?}

    G -->|Yes| J[High Activity]
    H -->|Yes| J
    I -->|Yes| J

    G -->|No| K{uniqueUsers >= 3?}
    H -->|No| L{messageCount >= 5?}

    K -->|Yes| M[Medium Activity]
    L -->|Yes| M

    K -->|No| N[Low Activity]
    L -->|No| N

    J --> O[Recommend: Blended]
    M --> P[Recommend: Consider Blended]
    N --> Q[Recommend: Individual]
```

---

## Function Executor Node

### OpenAI Function Calling with Streaming

```mermaid
sequenceDiagram
    participant Router as ResponseRouter
    participant Executor as FunctionExecutorNode
    participant OpenAI as OpenAI API
    participant Processor as FunctionProcessor
    participant ImageFlow as ImageGenerationFlow
    participant Discord as Discord API

    Router->>Executor: execute(store, data)

    rect rgb(240, 248, 255)
        Note over Executor,OpenAI: Initial AI Request
        Executor->>Executor: Prepare messages + function definitions
        Executor->>OpenAI: createChatCompletion(messages, tools)
        OpenAI-->>Executor: Response with tool_calls
    end

    alt Function Call Detected
        Executor->>Executor: Parse function name and arguments

        alt Image Generation Function
            rect rgb(255, 248, 240)
                Note over Executor,ImageFlow: Image Generation with Streaming
                Executor->>ImageFlow: processImageGeneration(args)
                ImageFlow->>Discord: Send initial "🎨 Creating..." message

                loop Every 5 seconds
                    ImageFlow->>Discord: Update with progress
                end

                ImageFlow->>ImageFlow: enhancePrompt
                ImageFlow->>OpenAI: DALL-E API call
                ImageFlow->>ImageFlow: Download and process image
                ImageFlow->>Discord: Upload final image
                ImageFlow-->>Executor: Image result with metadata
            end

        else Time/Weather/Other Functions
            Executor->>Processor: executeFunction(name, args)
            Processor->>Processor: Apply rate limiting
            Processor->>Processor: Execute API call
            Processor-->>Executor: Function result
        end

        rect rgb(240, 255, 240)
            Note over Executor,OpenAI: Natural Response Generation
            Executor->>Executor: Format function result
            Executor->>OpenAI: createChatCompletion(messages + result)
            OpenAI-->>Executor: Natural language response
        end

        Executor->>Discord: Update message with final response

    else Direct Response
        Executor->>Discord: Send AI response directly
    end

    Executor->>Executor: Update conversation store
    Executor-->>Router: Return response data
```

### Function Definition Structure

```mermaid
classDiagram
    class FunctionDefinition {
        +String type = "function"
        +Object function
    }

    class FunctionObject {
        +String name
        +String description
        +Object parameters
    }

    class Parameters {
        +String type = "object"
        +Object properties
        +Array~String~ required
    }

    FunctionDefinition --> FunctionObject
    FunctionObject --> Parameters

    class AvailableFunctions {
        <<enumeration>>
        lookupTime
        lookupWeather
        lookupExtendedForecast
        searchWeb
        lookupQuakeStats
        create_image
        wolframAlpha
    }

    FunctionObject ..> AvailableFunctions : implements
```

---

## Image Generation Flow (Streaming)

### State Machine with Progress Updates

```mermaid
stateDiagram-v2
    [*] --> Initializing: handleImageGeneration called

    Initializing --> Enhancing: Start progress updater

    state Enhancing {
        [*] --> CallingEnhance
        CallingEnhance --> WaitingForEnhancement
        WaitingForEnhancement --> EnhancementComplete
    }

    Enhancing --> Generating: Enhanced prompt ready

    state Generating {
        [*] --> CallingDALLE
        CallingDALLE --> WaitingForImage: DALL-E 3 attempt
        WaitingForImage --> ImageReturned: Success
        WaitingForImage --> RetryDALLE2: DALL-E 3 failed
        RetryDALLE2 --> WaitingForImage: DALL-E 2 attempt
    }

    Generating --> Downloading: Image URL received

    state Downloading {
        [*] --> FetchingImage
        FetchingImage --> BufferingData
        BufferingData --> DataComplete
    }

    Downloading --> Processing: Data downloaded

    state Processing {
        [*] --> DetermineFormat
        DetermineFormat --> ConvertToBuffer: Data URL
        DetermineFormat --> UseDirectly: Direct URL
        ConvertToBuffer --> CreateAttachment
        UseDirectly --> CreateAttachment
    }

    Processing --> Uploading: Attachment ready

    state Uploading {
        [*] --> UploadToDiscord
        UploadToDiscord --> UpdateMessage
        UpdateMessage --> StorePFP: If requested
        StorePFP --> Complete
        UpdateMessage --> Complete: Normal flow
    }

    Uploading --> Complete: Upload successful

    Enhancing --> Error: Enhancement timeout/error
    Generating --> Error: Generation failed (max retries)
    Downloading --> Error: Download failed
    Processing --> Error: Processing failed
    Uploading --> Error: Upload failed

    Error --> Retry: Retry available (< maxRetries)
    Retry --> Generating: Retry generation
    Error --> Failed: Max retries exceeded

    Complete --> [*]: Success
    Failed --> [*]: Failure with error message

    note right of Enhancing
        Progress: "🔮 Enhancing prompt..."
        Timer: Every 5s update
    end note

    note right of Generating
        Progress: "🎨 Generating image..."
        Multi-model fallback: DALL-E 3 → 2
    end note

    note right of Downloading
        Progress: "⬇️ Downloading..."
        Streaming buffer support
    end note

    note right of Processing
        Progress: "⚙️ Processing..."
        Format: b64_json/url/data_url
    end note

    note right of Uploading
        Progress: "📤 Uploading..."
        Final Discord attachment
    end note
```

### Image Generation Progress Timeline

```mermaid
gantt
    title Image Generation Timeline (Typical ~20-30s)
    dateFormat ss
    axisFormat %Ss

    section Initialization
    Setup and validation       :a1, 00, 1s

    section Enhancement
    Enhance prompt via GPT     :a2, 01, 3s

    section Generation
    DALL-E 3 API call         :a3, 04, 15s
    Fallback to DALL-E 2      :crit, 04, 15s

    section Download
    Download image data       :a4, 19, 2s

    section Processing
    Buffer and format         :a5, 21, 2s

    section Upload
    Upload to Discord         :a6, 23, 3s

    section Updates
    Progress update 1         :milestone, 05, 0s
    Progress update 2         :milestone, 10, 0s
    Progress update 3         :milestone, 15, 0s
    Progress update 4         :milestone, 20, 0s
    Complete                  :milestone, 26, 0s
```

---

## Conversation Store (Data Model)

### Store Structure and Relationships

```mermaid
classDiagram
    class ConversationStore {
        +Map~String,Conversation~ conversations
        +Map~String,ChannelContext~ channelContexts
        +Map~String,UserContext~ userContexts
        +Map~String,Intent~ botIntents
        +Map~String,ActiveFlow~ activeFlows
        +getConversation(userId) Conversation
        +updateConversation(userId, data)
        +getChannelContext(channelId) ChannelContext
        +updateChannelContext(channelId, data)
        +getUserContext(userId) UserContext
        +updateUserContext(userId, data)
        +setBotIntent(messageId, intent)
        +getBotIntent(messageId) Intent
        +setActiveFlow(userId, type, data)
        +clearActiveFlow(userId)
        +cleanup(maxAge)
        +getStats() Object
        +getAll() Object
    }

    class Conversation {
        +Array~Message~ messages
        +Date lastActivity
        +Number messageCount
        +Object context
        +Number tokenCount
        +Date createdAt
    }

    class Message {
        +String role
        +String content
        +Number timestamp
        +String messageId
        +String userId
        +Object functionCall
    }

    class ChannelContext {
        +Array~Message~ recentMessages
        +Array~RoutingDecision~ routingHistory
        +Date lastActivity
        +Number messageCount
        +Object activity
    }

    class UserContext {
        +Array~Intent~ intentHistory
        +Array~RoutingDecision~ routingHistory
        +Object preferences
        +String location
        +String timezone
        +Date createdAt
    }

    class Intent {
        +Boolean isBotDirected
        +Number confidence
        +Array~String~ patterns
        +Number timestamp
        +Boolean fromBot
    }

    class RoutingDecision {
        +String mode
        +String reason
        +Number confidence
        +Number timestamp
        +String messageId
        +String channelId
    }

    class ActiveFlow {
        +String type
        +String userId
        +Number startTime
        +String messageId
        +Object flowData
    }

    ConversationStore --> Conversation : manages
    ConversationStore --> ChannelContext : manages
    ConversationStore --> UserContext : manages
    ConversationStore --> Intent : tracks
    ConversationStore --> ActiveFlow : tracks

    Conversation --> Message : contains
    ChannelContext --> Message : contains
    ChannelContext --> RoutingDecision : tracks
    UserContext --> Intent : tracks
    UserContext --> RoutingDecision : tracks
```

### Store Cleanup and Memory Management

```mermaid
flowchart TD
    A[Periodic Cleanup Timer: 5 minutes] --> B[cleanup method called]

    B --> C[Get current timestamp]
    C --> D[Calculate maxAge threshold]

    D --> E[Iterate conversations Map]
    E --> F{lastActivity > maxAge?}
    F -->|Yes| G[Keep conversation]
    F -->|No| H[Delete conversation]

    H --> I[Log cleanup: userId]
    G --> J[Continue]
    I --> J

    J --> K{More conversations?}
    K -->|Yes| E
    K -->|No| L[Iterate channelContexts Map]

    L --> M{lastActivity > maxAge?}
    M -->|Yes| N[Keep context]
    M -->|No| O[Delete context]

    O --> P[Log cleanup: channelId]
    N --> Q[Continue]
    P --> Q

    Q --> R{More channels?}
    R -->|Yes| L
    R -->|No| S[Iterate activeFlows Map]

    S --> T{Flow older than maxAge?}
    T -->|Yes| U[Clear stale flow]
    T -->|No| V[Keep flow]

    U --> W[Log cleanup: flowId]
    V --> X[Continue]
    W --> X

    X --> Y{More flows?}
    Y -->|Yes| S
    Y -->|No| Z[Cleanup complete]

    Z --> AA[Log statistics]
    AA --> AB[Return cleanup summary]

    style H fill:#ffcdd2
    style O fill:#ffcdd2
    style U fill:#ffcdd2
    style G fill:#c8e6c9
    style N fill:#c8e6c9
    style V fill:#c8e6c9
```

---

## Complete Data Flow Example

### Full Message Processing Journey

```mermaid
flowchart TD
    Start([User sends: 'draw an image of a sunset']) --> A[Discord messageCreate event]

    A --> B[chimpGPT.js: Message handler]
    B --> C{Is bot message?}
    C -->|Yes| End1([Ignore])
    C -->|No| D{Authorized channel?}
    D -->|No| End2([Ignore])
    D -->|Yes| E[pocketFlowAdapter.manageConversation]

    E --> F[PocketFlowConversationManager.processMessage]
    F --> G[determineFlowType: 'individual']

    G --> H[IndividualConversationFlow.processMessage]
    H --> I[Flow.run with startNode]

    I --> J[IntentDetectionNode.execute]
    J --> K[Pattern matching: 'draw' + 'image']
    K --> L[High confidence pattern matched: +0.7]
    L --> M[Final confidence: 0.7]
    M --> N[Store intent in SharedStore]
    N --> O[Pass to ContextManagerNode]

    O --> P[ContextManagerNode.execute]
    P --> Q[buildIndividualContext]
    Q --> R[Get user conversation from Store]
    R --> S[Add system message + user message]
    S --> T[Optimize for token limit]
    T --> U[Update conversation in Store]
    U --> V[Pass to ResponseRouterNode]

    V --> W[ResponseRouterNode.execute]
    W --> X[determineConversationMode]
    X --> Y{Intent confidence >= 0.8?}
    Y -->|No: 0.7| Z{Is DM?}
    Z -->|No| AA{Confidence >= 0.5?}
    AA -->|Yes: 0.7| AB[Route: Individual<br/>Reason: moderate_confidence]
    AB --> AC[Store routing decision]
    AC --> AD[Pass to FunctionExecutorNode]

    AD --> AE[FunctionExecutorNode.execute]
    AE --> AF[OpenAI API: createChatCompletion<br/>with function definitions]

    AF --> AG[OpenAI returns tool_calls:<br/>create_image]
    AG --> AH[Parse function: 'create_image']
    AH --> AI[Parameters: prompt, size, style]

    AI --> AJ[ImageGenerationFlow.processImageGeneration]

    AJ --> AK[Phase: Initializing<br/>Send Discord message:<br/>'🎨 Creating...']

    AK --> AL[Start progress updater: 5s intervals]
    AL --> AM[Phase: Enhancing<br/>Update: '🔮 Enhancing prompt...']

    AM --> AN[enhanceImagePrompt via GPT-4]
    AN --> AO[Enhanced prompt returned]

    AO --> AP[Phase: Generating<br/>Update: '🎨 Generating image...']
    AP --> AQ[Call DALL-E 3 API]

    AQ --> AR{Success?}
    AR -->|Yes| AS[Image URL returned]
    AR -->|No| AT[Fallback: DALL-E 2]
    AT --> AS

    AS --> AU[Phase: Downloading<br/>Update: '⬇️ Downloading...']
    AU --> AV[Download image data]

    AV --> AW[Phase: Processing<br/>Update: '⚙️ Processing...']
    AW --> AX[Convert to Discord attachment]

    AX --> AY[Phase: Uploading<br/>Update: '📤 Uploading...']
    AY --> AZ[Upload to Discord]

    AZ --> BA[Stop progress updater]
    BA --> BB[Update message with final image]

    BB --> BC[Return function result to FunctionExecutor]
    BC --> BD[Send function result to OpenAI]
    BD --> BE[OpenAI generates natural response:<br/>'Here's your sunset image!']

    BE --> BF[Update conversation store with assistant message]
    BF --> BG[Return to IndividualConversationFlow]

    BG --> BH[Return to PocketFlowConversationManager]
    BH --> BI[Return to pocketFlowAdapter]
    BI --> BJ[Return to chimpGPT message handler]

    BJ --> BK[Final Discord message edit]
    BK --> BL[Update bot status]
    BL --> End3([Complete])

    style K fill:#fff4e1
    style L fill:#c8e6c9
    style AG fill:#e1f5ff
    style AJ fill:#fff4e1
    style AS fill:#c8e6c9
    style BE fill:#c8e6c9
```

---

## Performance Characteristics

### Execution Time Breakdown

| Phase | Average Time | Notes |
|-------|--------------|-------|
| Intent Detection | 5-10ms | Pattern matching only |
| Context Management | 50-100ms | Includes token optimization |
| Response Routing | 5-10ms | Decision logic only |
| OpenAI Function Call | 1-3s | Network + API processing |
| Image Generation | 15-30s | DALL-E API + processing |
| Other Functions | 0.5-2s | Weather, time, search APIs |
| Natural Response | 1-2s | OpenAI text generation |
| **Total (no image)** | **2-7s** | Typical conversation response |
| **Total (with image)** | **20-35s** | Image generation flow |

### Memory Footprint

```mermaid
pie title Typical Memory Usage (Active Conversation)
    "Conversation Messages" : 40
    "Store Metadata" : 15
    "Intent History" : 10
    "Routing History" : 10
    "Active Flows" : 15
    "Node State" : 10
```

---

## Error Handling Patterns

### Error Propagation Through Nodes

```mermaid
flowchart TD
    A[Node Action Throws Error] --> B{Within safeExecute?}
    B -->|Yes| C[Catch error]
    B -->|No| D[Unhandled error]

    C --> E[logError with details]
    E --> F{retries > 0?}

    F -->|Yes| G[Decrement retries]
    F -->|No| H[Call handleError]

    G --> I[Retry safeExecute]
    I --> J{Success?}
    J -->|Yes| K[Return result]
    J -->|No| F

    H --> L[Create error result object]
    L --> M[Return to Flow]

    M --> N{Has onError connection?}
    N -->|Yes| O[Execute error handler node]
    N -->|No| P[Propagate error to Flow]

    O --> Q[Error handler processes]
    Q --> R{Can recover?}
    R -->|Yes| S[Return recovery result]
    R -->|No| P

    P --> T[Flow returns error to Manager]
    T --> U[Manager logs error]
    U --> V[Return error to adapter]
    V --> W[Fallback to legacy system]

    K --> X[Continue normal flow]
    S --> X

    style C fill:#fff4e1
    style H fill:#ffcdd2
    style O fill:#e1f5ff
    style W fill:#ffccbc
```

### Common Error Scenarios

| Error Type | Handling Strategy | Recovery |
|-----------|------------------|----------|
| **Timeout** | Retry with exponential backoff | 2 retries, then error |
| **OpenAI API Error** | Log, return user-friendly message | Fallback to legacy |
| **Rate Limit** | Queue or delay | Wait and retry |
| **Function Error** | Log, return function error to OpenAI | AI generates error response |
| **Store Error** | Log, use empty context | Continue with minimal context |
| **Node Error** | Retry if configured | Execute error handler node |
| **Discord Error** | Retry upload/edit | Log and alert owner |

---

## Best Practices

### 1. Node Design
✅ **Single Responsibility**: Each node does one thing well
✅ **Timeout Protection**: All async operations have timeouts
✅ **Error Handling**: Always use safeExecute wrapper
✅ **Store Updates**: Update store at node boundaries
✅ **Logging**: Use debug logging for node execution

### 2. Flow Composition
✅ **Linear Flow**: Keep flows as linear as possible
✅ **Conditional Branching**: Use onCondition for complex routing
✅ **Error Paths**: Always provide error handling paths
✅ **Store Isolation**: Each flow has its own store instance
✅ **Cleanup**: Implement cleanup for long-running flows

### 3. Store Management
✅ **Namespacing**: Use clear key names (userId, channelId)
✅ **Cleanup**: Regular cleanup of old data
✅ **Immutability**: Don't mutate stored objects directly
✅ **Validation**: Validate data before storing
✅ **Metrics**: Track store size and performance

### 4. Performance
✅ **Token Optimization**: Always optimize context before API calls
✅ **Caching**: Cache expensive computations
✅ **Parallel Processing**: Use concurrent flows when possible
✅ **Progress Updates**: Provide feedback for long operations
✅ **Monitoring**: Track execution times and success rates

---

## Comparison: PocketFlow vs Legacy

| Aspect | PocketFlow | Legacy |
|--------|-----------|--------|
| **Architecture** | Graph-based nodes | Monolithic handler |
| **Complexity** | 60% reduction | High coupling |
| **Testability** | Each node testable | End-to-end only |
| **Maintainability** | High (modular) | Medium (coupled) |
| **Performance** | Optimized routing | Always processes all |
| **Context Management** | Dynamic token optimization | Fixed pruning |
| **Error Handling** | Node-level retry + recovery | Global try-catch |
| **Extensibility** | Add new nodes easily | Modify core logic |
| **State Management** | Centralized Store | Scattered across files |
| **Memory Usage** | Efficient cleanup | Manual management |

---

## Future Enhancements

### Planned Improvements

1. **Multi-Model Support**: Route to different AI models based on intent
2. **Enhanced Caching**: Cache function results and AI responses
3. **Conversation Summarization**: Automatic long conversation summarization
4. **Sentiment Analysis**: Route based on message sentiment
5. **User Preferences**: Per-user conversation settings
6. **Analytics Dashboard**: Real-time flow performance metrics
7. **A/B Testing**: Compare different flow configurations
8. **Plugin Nodes**: Allow plugins to add custom nodes

---

## Troubleshooting Guide

### Common Issues

**Issue**: Message not being processed
**Check**: Intent detection confidence (must be > 0.4)
**Solution**: Adjust botDirectedPatterns or confidenceThreshold

**Issue**: Context too large (token limit exceeded)
**Check**: Conversation length, maxConversationLength setting
**Solution**: Reduce maxConversationLength or increase emergencyMaxTokens

**Issue**: Image generation timeout
**Check**: DALL-E API status, network connectivity
**Solution**: Increase FunctionExecutorNode timeout, check retries

**Issue**: Store growing too large
**Check**: Cleanup interval, maxAge setting
**Solution**: Reduce cleanup interval or maxAge threshold

**Issue**: Wrong flow type selected
**Check**: Response routing logs, channel activity metrics
**Solution**: Adjust routing thresholds (confidenceThreshold, blendedChannelThreshold)

---

## Code Examples

### Creating a Custom Node

```javascript
const BaseConversationNode = require('./nodes/BaseNode');
const { createLogger } = require('../../core/logger');

const logger = createLogger('CustomNode');

class CustomNode extends BaseConversationNode {
  constructor(options = {}) {
    const action = async (store, data) => {
      return await this.processCustomLogic(store, data);
    };

    super('custom_node', action, {
      timeout: 5000,
      logLevel: 'debug',
      ...options,
    });

    this.config = {
      // Custom configuration
      ...options.config,
    };
  }

  async processCustomLogic(store, data) {
    try {
      // Your custom logic here
      const result = await this.doSomething(data);

      // Update store if needed
      store.set('customData', result);

      return {
        success: true,
        result: result,
        data: data,
      };
    } catch (error) {
      logger.error('Custom logic failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async doSomething(data) {
    // Implementation
    return data;
  }
}

module.exports = CustomNode;
```

### Building a Custom Flow

```javascript
const { Flow } = require('../PocketFlow');
const ConversationStore = require('../ConversationStore');
const CustomNode = require('../nodes/CustomNode');
const FunctionExecutorNode = require('../nodes/FunctionExecutorNode');

class CustomFlow {
  constructor(openaiClient, functionCallProcessor, options = {}) {
    this.store = new ConversationStore();
    this.options = options;

    // Create nodes
    this.customNode = new CustomNode(this.options.custom);
    this.functionNode = new FunctionExecutorNode(
      openaiClient,
      functionCallProcessor,
      this.options.function
    );

    // Set up connections
    this.customNode
      .onSuccess(this.functionNode)
      .onError(this.createErrorHandler());

    // Build flow
    this.flow = new Flow(this.customNode, this.store);
  }

  async processMessage(messageData) {
    try {
      const result = await this.flow.run({
        message: messageData.message,
        context: messageData.context,
      });

      return {
        success: true,
        result: result,
        flowType: 'custom',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  createErrorHandler() {
    const BaseConversationNode = require('../nodes/BaseNode');
    return new BaseConversationNode('error_handler', async (store, data) => {
      // Handle errors
      return {
        success: false,
        error: 'Custom flow error',
        recovery: true,
      };
    });
  }

  getStore() {
    return this.store;
  }
}

module.exports = CustomFlow;
```

---

## References

- [PocketFlow Original Concept](https://github.com/yourusername/pocketflow)
- [OpenAI Function Calling Guide](https://platform.openai.com/docs/guides/function-calling)
- [Discord.js Documentation](https://discord.js.org/)
- [Conversation Flow Documentation](./CONVERSATION_FLOW.md)
- [Error Handling Guide](./ERROR_HANDLING.md)

---

**Document Version**: 1.0.0
**Last Updated**: 2025-12-27
**Maintained By**: ChimpGPT Development Team
