/**
 * Multi-Bot Navigation Component
 *
 * Provides navigation between different ChimpGPT bot instances
 * Integrates with existing header and discovers active bots dynamically
 *
 * @version 1.0.0
 * @author Brett
 */

class BotNavigation {
  constructor() {
    this.botInstances = [];
    this.currentBot = null;
    this.refreshInterval = null;
    this.isInitialized = false;

    // Configuration
    this.config = {
      refreshInterval: 30000, // 30 seconds
      discoveryTimeout: 5000, // 5 seconds
      retryAttempts: 3,
      retryDelay: 1000, // 1 second
    };

    this.init();
  }

  /**
   * Initialize the navigation component
   */
  async init() {
    if (this.isInitialized) return;

    console.log('🤖 Initializing Bot Navigation...');

    try {
      // Create navigation UI
      this.createNavigationUI();

      // Discover active bots
      await this.discoverBots();

      // Start periodic refresh
      this.startPeriodicRefresh();

      this.isInitialized = true;
      console.log('✅ Bot Navigation initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Bot Navigation:', error);
      this.showError('Failed to initialize bot navigation');
    }
  }

  /**
   * Create the navigation UI in the header
   */
  createNavigationUI() {
    const header = document.querySelector('header .header-controls');
    if (!header) {
      throw new Error('Header controls not found');
    }

    // Create bot navigation container
    const navContainer = document.createElement('div');
    navContainer.className = 'bot-navigation';
    navContainer.innerHTML = `
            <div class="bot-nav-dropdown">
                <button class="bot-nav-toggle" id="bot-nav-toggle" title="Switch Bot Instance">
                    <i class="fas fa-robot"></i>
                    <span class="bot-nav-current">Loading...</span>
                    <i class="fas fa-chevron-down bot-nav-arrow"></i>
                </button>
                <div class="bot-nav-menu" id="bot-nav-menu">
                    <div class="bot-nav-header">
                        <span>Available Bots</span>
                        <button class="bot-nav-refresh" id="bot-nav-refresh" title="Refresh Bot List">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                    <div class="bot-nav-list" id="bot-nav-list">
                        <div class="bot-nav-loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Discovering bots...</span>
                        </div>
                    </div>
                    <div class="bot-nav-footer">
                        <small id="bot-nav-status">Last updated: Never</small>
                    </div>
                </div>
            </div>
        `;

    // Insert before the time display
    const timeElement = header.querySelector('.time');
    header.insertBefore(navContainer, timeElement);

    // Add event listeners
    this.attachEventListeners();

    // Add CSS styles
    this.addNavigationStyles();
  }

  /**
   * Add CSS styles for the navigation component
   */
  addNavigationStyles() {
    const style = document.createElement('style');
    style.textContent = `
            /* Bot Navigation Styles */
            .bot-navigation {
                position: relative;
                margin-right: 1rem;
            }
            
            .bot-nav-dropdown {
                position: relative;
            }
            
            .bot-nav-toggle {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.5rem 0.75rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: 6px;
                color: var(--text);
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 0.875rem;
                min-width: 120px;
            }
            
            .bot-nav-toggle:hover {
                background: var(--hover);
                border-color: var(--accent);
            }
            
            .bot-nav-toggle.active {
                background: var(--accent);
                color: white;
                border-color: var(--accent);
            }
            
            .bot-nav-current {
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 80px;
            }
            
            .bot-nav-arrow {
                font-size: 0.75rem;
                margin-left: auto;
                transition: transform 0.2s ease;
            }
            
            .bot-nav-toggle.active .bot-nav-arrow {
                transform: rotate(180deg);
            }
            
            .bot-nav-menu {
                position: absolute;
                top: 100%;
                right: 0;
                margin-top: 0.5rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                min-width: 280px;
                max-width: 400px;
                z-index: 1000;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px);
                transition: all 0.2s ease;
            }
            
            .bot-nav-menu.active {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }
            
            .bot-nav-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.75rem 1rem;
                border-bottom: 1px solid var(--border);
                font-weight: 600;
                font-size: 0.875rem;
                color: var(--text);
            }
            
            .bot-nav-refresh {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                padding: 0.25rem;
                border-radius: 4px;
                transition: color 0.2s ease;
            }
            
            .bot-nav-refresh:hover {
                color: var(--accent);
            }
            
            .bot-nav-refresh.spinning {
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            .bot-nav-list {
                max-height: 300px;
                overflow-y: auto;
                padding: 0.5rem 0;
            }
            
            .bot-nav-loading,
            .bot-nav-error {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 1rem;
                color: var(--text-secondary);
                font-size: 0.875rem;
                justify-content: center;
            }
            
            .bot-nav-error {
                color: var(--error);
            }
            
            .bot-nav-item {
                display: flex;
                align-items: center;
                padding: 0.75rem 1rem;
                cursor: pointer;
                transition: background-color 0.2s ease;
                border: none;
                background: none;
                width: 100%;
                text-align: left;
            }
            
            .bot-nav-item:hover {
                background: var(--hover);
            }
            
            .bot-nav-item.current {
                background: var(--accent-bg);
                color: var(--accent);
            }
            
            .bot-nav-item.current::after {
                content: '●';
                margin-left: auto;
                font-size: 0.75rem;
            }
            
            .bot-nav-icon {
                width: 32px;
                height: 32px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-right: 0.75rem;
                font-size: 1rem;
                flex-shrink: 0;
            }
            
            .bot-nav-icon.online {
                background: var(--success-bg);
                color: var(--success);
            }
            
            .bot-nav-icon.offline {
                background: var(--error-bg);
                color: var(--error);
            }
            
            .bot-nav-icon.unknown {
                background: var(--warning-bg);
                color: var(--warning);
            }
            
            .bot-nav-details {
                flex: 1;
                min-width: 0;
            }
            
            .bot-nav-name {
                font-weight: 600;
                font-size: 0.875rem;
                color: var(--text);
                margin-bottom: 0.125rem;
            }
            
            .bot-nav-info {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: 0.75rem;
                color: var(--text-secondary);
            }
            
            .bot-nav-status {
                display: inline-flex;
                align-items: center;
                gap: 0.25rem;
                padding: 0.125rem 0.375rem;
                background: var(--bg-tertiary);
                border-radius: 12px;
                font-size: 0.625rem;
                text-transform: uppercase;
                font-weight: 600;
                letter-spacing: 0.025em;
            }
            
            .bot-nav-status.online {
                background: var(--success-bg);
                color: var(--success);
            }
            
            .bot-nav-status.offline {
                background: var(--error-bg);
                color: var(--error);
            }
            
            .bot-nav-footer {
                padding: 0.5rem 1rem;
                border-top: 1px solid var(--border);
                text-align: center;
            }
            
            .bot-nav-footer small {
                color: var(--text-secondary);
                font-size: 0.75rem;
            }
            
            /* Responsive design */
            @media (max-width: 768px) {
                .bot-nav-menu {
                    right: -1rem;
                    left: -1rem;
                    width: auto;
                    min-width: unset;
                    max-width: unset;
                }
                
                .bot-nav-current {
                    max-width: 60px;
                }
            }
        `;

    document.head.appendChild(style);
  }

  /**
   * Attach event listeners to navigation elements
   */
  attachEventListeners() {
    const toggle = document.getElementById('bot-nav-toggle');
    const refresh = document.getElementById('bot-nav-refresh');

    // Toggle dropdown
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
      if (!e.target.closest('.bot-navigation')) {
        this.closeDropdown();
      }
    });

    // Refresh bot list
    refresh.addEventListener('click', async e => {
      e.stopPropagation();
      await this.refreshBotList();
    });

    // Handle escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.closeDropdown();
      }
    });
  }

  /**
   * Toggle the dropdown menu
   */
  toggleDropdown() {
    const toggle = document.getElementById('bot-nav-toggle');

    const isActive = toggle.classList.contains('active');

    if (isActive) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  /**
   * Open the dropdown menu
   */
  openDropdown() {
    const toggle = document.getElementById('bot-nav-toggle');
    const menu = document.getElementById('bot-nav-menu');

    toggle.classList.add('active');
    menu.classList.add('active');
  }

  /**
   * Close the dropdown menu
   */
  closeDropdown() {
    const toggle = document.getElementById('bot-nav-toggle');
    const menu = document.getElementById('bot-nav-menu');

    toggle.classList.remove('active');
    menu.classList.remove('active');
  }

  /**
   * Discover active bot instances
   */
  async discoverBots() {
    try {
      console.log('🔍 Discovering active bots...');

      const response = await this.fetchWithTimeout('/api/discover-services', {
        timeout: this.config.discoveryTimeout,
      });

      if (!response.ok) {
        throw new Error(`Discovery API failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error('Discovery API returned unsuccessful response');
      }

      // Process discovered bots
      this.processBotData(data);

      // Update UI
      this.updateNavigationUI();

      console.log(`✅ Discovered ${this.botInstances.length} bot instances`);
    } catch (error) {
      console.error('❌ Failed to discover bots:', error);
      this.showError(error.message);
    }
  }

  /**
   * Process bot data from discovery API
   */
  processBotData(data) {
    this.botInstances = [];

    if (data.botServices && Array.isArray(data.botServices)) {
      // Group by bot name to handle multiple ports per bot
      const botGroups = {};

      data.botServices.forEach(bot => {
        const name = bot.serviceInfo?.botName || bot.serviceInfo?.name || 'Unknown Bot';

        if (!botGroups[name]) {
          botGroups[name] = {
            name: name,
            instances: [],
          };
        }

        botGroups[name].instances.push(bot);
      });

      // Convert groups to bot instances
      Object.values(botGroups).forEach(group => {
        // Find the best instance (prioritize online status and higher ports)
        const bestInstance = group.instances.reduce((best, current) => {
          if (!best) return current;

          // Prefer online status
          if (
            current.serviceInfo?.discordStatus === 'ok' &&
            best.serviceInfo?.discordStatus !== 'ok'
          ) {
            return current;
          }

          // Prefer higher ports (usually more recent instances)
          if (current.port > best.port) {
            return current;
          }

          return best;
        }, null);

        this.botInstances.push({
          name: group.name,
          port: bestInstance.port,
          url: bestInstance.dashboardUrl || `http://localhost:${bestInstance.port}/#performance`,
          status:
            bestInstance.serviceInfo?.discordStatus ||
            bestInstance.serviceInfo?.status ||
            'unknown',
          uptime: bestInstance.serviceInfo?.formattedUptime || 'Unknown',
          version: bestInstance.serviceInfo?.version || 'Unknown',
          messageCount: bestInstance.serviceInfo?.stats?.messageCount || 0,
          guilds: bestInstance.serviceInfo?.discordGuilds || 0,
          memory: bestInstance.serviceInfo?.memoryUsage?.rss || 'Unknown',
          isCurrent: this.isCurrentBot(bestInstance.port),
          instances: group.instances,
        });
      });
    }

    // Sort by name for consistent ordering
    this.botInstances.sort((a, b) => a.name.localeCompare(b.name));

    // Identify current bot
    this.currentBot = this.botInstances.find(bot => bot.isCurrent) || null;
  }

  /**
   * Check if a bot instance is the current one
   */
  isCurrentBot(port) {
    const currentPort = window.location.port || '3001';
    return port.toString() === currentPort;
  }

  /**
   * Update the navigation UI with discovered bots
   */
  updateNavigationUI() {
    const currentSpan = document.querySelector('.bot-nav-current');
    const listContainer = document.getElementById('bot-nav-list');
    const statusElement = document.getElementById('bot-nav-status');

    // Update current bot display
    if (this.currentBot) {
      currentSpan.textContent = this.currentBot.name;
      currentSpan.title = `${this.currentBot.name} (Port ${this.currentBot.port})`;
    } else {
      currentSpan.textContent = 'Unknown';
      currentSpan.title = 'Current bot not identified';
    }

    // Update bot list
    if (this.botInstances.length === 0) {
      listContainer.innerHTML = `
                <div class="bot-nav-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>No bots discovered</span>
                </div>
            `;
    } else {
      listContainer.innerHTML = this.botInstances
        .map(
          bot => `
                <button class="bot-nav-item ${bot.isCurrent ? 'current' : ''}"
                        onclick="_botNavigation.navigateToBot('${bot.url}')"
                        title="Switch to ${bot.name}">
                    <div class="bot-nav-icon ${bot.status}">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div class="bot-nav-details">
                        <div class="bot-nav-name">${bot.name}</div>
                        <div class="bot-nav-info">
                            <span class="bot-nav-status ${bot.status}">${bot.status}</span>
                            <span>Port ${bot.port}</span>
                            <span>${bot.uptime}</span>
                            <span>${bot.messageCount} msgs</span>
                        </div>
                    </div>
                </button>
            `
        )
        .join('');
    }

    // Update last updated timestamp
    statusElement.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  }

  /**
   * Navigate to a different bot instance
   */
  navigateToBot(url) {
    if (!url) {
      console.error('❌ No URL provided for navigation');
      return;
    }

    console.log(`🚀 Navigating to bot: ${url}`);

    // Close dropdown
    this.closeDropdown();

    // Navigate to the bot's dashboard
    window.location.href = url;
  }

  /**
   * Refresh the bot list
   */
  async refreshBotList() {
    const refreshBtn = document.getElementById('bot-nav-refresh');

    try {
      // Show loading state
      refreshBtn.classList.add('spinning');

      await this.discoverBots();
    } catch (error) {
      console.error('❌ Failed to refresh bot list:', error);
      this.showError('Failed to refresh bot list');
    } finally {
      // Remove loading state
      refreshBtn.classList.remove('spinning');
    }
  }

  /**
   * Start periodic refresh of bot list
   */
  startPeriodicRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    this.refreshInterval = setInterval(async () => {
      try {
        await this.discoverBots();
      } catch (error) {
        console.warn('⚠️ Periodic refresh failed:', error.message);
      }
    }, this.config.refreshInterval);

    console.log(`🔄 Started periodic refresh every ${this.config.refreshInterval / 1000}s`);
  }

  /**
   * Stop periodic refresh
   */
  stopPeriodicRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('⏹️ Stopped periodic refresh');
    }
  }

  /**
   * Show error message in the navigation
   */
  showError(message) {
    const listContainer = document.getElementById('bot-nav-list');
    if (listContainer) {
      listContainer.innerHTML = `
                <div class="bot-nav-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>${message}</span>
                </div>
            `;
    }
  }

  /**
   * Fetch with timeout support
   */
  async fetchWithTimeout(url, options = {}) {
    const { timeout = 5000, ...fetchOptions } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Destroy the navigation component
   */
  destroy() {
    this.stopPeriodicRefresh();

    const navContainer = document.querySelector('.bot-navigation');
    if (navContainer) {
      navContainer.remove();
    }

    this.isInitialized = false;
    console.log('🗑️ Bot Navigation destroyed');
  }
}

// Global instance
let _botNavigation = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    _botNavigation = new BotNavigation();
  });
} else {
  _botNavigation = new BotNavigation();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BotNavigation;
}
