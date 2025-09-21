# Enhanced Multi-Engine Web Search System

## Overview

The Chimp-GPT Discord bot now features an enhanced web search system with multiple search engines and intelligent routing, following PocketFlow patterns for better real-time data retrieval.

## Search Engines Supported

### 1. SerpApi (Google Search) - **Primary**
- **Best for**: Real-time data, financial prices, current events, news
- **Features**: 
  - Google Answer Boxes (instant answers)
  - Knowledge Graph data
  - Featured snippets
  - Organic search results
- **API Key**: `SERPAPI_API_KEY` (100 free searches/month)
- **Cost**: $75/month for 5,000 searches

### 2. Brave Search API - **Secondary**
- **Best for**: General queries, technical content, developer resources
- **Features**:
  - Featured snippets
  - Web search results
  - Privacy-focused
- **API Key**: `BRAVE_SEARCH_API_KEY` (2,000 free searches/month)
- **Cost**: $3-$5 per 1,000 searches

### 3. DuckDuckGo API - **Fallback**
- **Best for**: Instant answers, definitions, factual queries
- **Features**:
  - Instant answers
  - Abstract summaries
  - Related topics
- **API Key**: None required (free)
- **Limitations**: No real-time financial data

## Intelligent Engine Selection

The system automatically selects the best search engine based on query patterns:

### Financial/Real-Time Queries → SerpApi
- Keywords: `price`, `bitcoin`, `stock`, `current`, `latest`, `today`, `cryptocurrency`, `market`, `usd`
- Example: "What is the current price of Bitcoin?" → Uses SerpApi for real-time data

### News/Trending Topics → SerpApi
- Keywords: `news`, `breaking`, `recent`, `2025`, `2024`, `happening`
- Example: "Latest news about JavaScript frameworks" → Uses SerpApi

### Technical/Programming → Brave Search
- Keywords: `programming`, `code`, `javascript`, `python`, `react`, `api`, `documentation`, `tutorial`
- Example: "How to implement React hooks" → Uses Brave Search

### General Factual → DuckDuckGo
- Keywords: `what is`, `who is`, `definition`, `meaning`, `explain`
- Example: "What is machine learning?" → Uses DuckDuckGo

## Configuration

Add these environment variables to `.env`:

```bash
# Enhanced Web Search Configuration
SERPAPI_API_KEY=your_serpapi_key_here
BRAVE_SEARCH_API_KEY=your_brave_api_key_here
```

## Fallback Strategy

1. **Primary Engine**: Selected based on query type
2. **Secondary Fallback**: If primary fails, tries next best engine
3. **Final Fallback**: DuckDuckGo (always available, no API key needed)

## Bitcoin Price Query Fix

The original issue with "What is the current price of Bitcoin?" has been resolved:

### Before (DuckDuckGo Only)
- ❌ Empty results from DuckDuckGo API
- ❌ 16% confidence score
- ❌ Fallback to generic conversation

### After (Enhanced Search)
- ✅ SerpApi automatically selected for price queries
- ✅ Google Answer Box provides real-time Bitcoin price
- ✅ High confidence score with actual data
- ✅ Proper financial disclaimer and source attribution

## Testing the Enhanced Search

Try these queries to test different engines:

1. **Financial (SerpApi)**: "What is the current price of Bitcoin?"
2. **Technical (Brave)**: "Best JavaScript frameworks in 2025"
3. **Factual (DuckDuckGo)**: "What is artificial intelligence?"
4. **News (SerpApi)**: "Latest React updates"

## API Costs and Limits

| Engine | Free Tier | Paid Plans | Best For |
|--------|-----------|------------|----------|
| SerpApi | 100/month | $75/month (5K) | Real-time data |
| Brave | 2,000/month | $3-5/1K | General search |
| DuckDuckGo | Unlimited | Free | Instant answers |

## Performance Improvements

- **Real-time Data**: Now gets actual Bitcoin prices, stock quotes, current events
- **Better Accuracy**: Multiple engines provide redundancy and higher confidence
- **Intelligent Routing**: Queries automatically use the best engine for the task
- **Enhanced Formatting**: Results include answer boxes, knowledge graphs, and structured data

## Implementation Details

- **Circuit Breaker Protection**: All engines protected with retry logic
- **Query Sanitization**: Input sanitization prevents API abuse
- **Result Caching**: Successful searches cached to improve performance
- **Logging**: Comprehensive logging for debugging and monitoring
- **Error Handling**: Graceful fallbacks when engines fail

## Next Steps

1. Add API keys to production environment
2. Monitor usage and costs
3. Consider adding more specialized APIs (cryptocurrency, weather, etc.)
4. Implement rate limiting for heavy usage scenarios