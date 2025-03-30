/**
 * Fintoc to Actual Budget Synchronization Tool
 * 
 * This script syncs financial data from Fintoc to Actual Budget software.
 * It handles both creating new budgets and updating existing ones.
 */
import { Fintoc } from 'fintoc';
import * as actual_api from '@actual-app/api';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Parse a comma-separated string from env var into an array
 * @param {string} envVar - Environment variable value
 * @returns {string[]} Array of values
 */
const parseArrayFromEnv = (envVar) => {
  if (!envVar) return [];
  return envVar.split(',').map(item => item.trim());
};

// ====== CONFIGURATION ======
const CONFIG = {
  FINTOC_API_KEY: process.env.FINTOC_API_KEY,
  LINK_TOKENS: parseArrayFromEnv(process.env.FINTOC_LINK_TOKENS),
  ACTUAL_DATA_DIR: process.env.ACTUAL_DATA_DIR,
  ACTUAL_BUDGET_NAME: process.env.ACTUAL_BUDGET_NAME,
  MOVEMENTS_SINCE: process.env.MOVEMENTS_SINCE,
  ACCOUNTS_JSON_FILE: process.env.ACCOUNTS_JSON_FILE,
};

// ====== LOGGING ======
const logger = {
  info: (message, data) => console.log(`INFO: ${message}`, data || ''),
  warn: (message, data) => console.warn(`WARN: ${message}`, data || ''),
  error: (message, error) => console.error(`ERROR: ${message}`, error)
};

// ====== UTILITY FUNCTIONS ======
/**
 * Safely executes a function with error handling
 * @param {Function} fn - Function to execute
 * @param {string} errorMessage - Error message to log if failed
 * @param {*} defaultValue - Default value to return if failed
 * @returns {*} Function result or default value
 */
const safeExecute = async (fn, errorMessage, defaultValue = []) => {
  try {
    return await fn();
  } catch (error) {
    logger.error(errorMessage, error);
    return defaultValue;
  }
};

/**
 * Saves data to a JSON file
 * @param {string} filePath - Path to save file
 * @param {Object} data - Data to save
 * @returns {Promise<boolean>} Success status
 */
const saveToJsonFile = async (filePath, data) => {
  try {
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    logger.info(`Data saved to ${filePath}`);
    return true;
  } catch (error) {
    logger.error(`Failed to save data to ${filePath}`, error);
    return false;
  }
};

// ====== DATA MODELS ======
/**
 * Account model that bridges Fintoc and Actual accounts
 */
class Account {
  constructor(fintocData = null, institution = null, actualId = null) {
    this.fintoc = fintocData;
    this.institution = institution;
    this.actualId = actualId;
  }

  // Accessor properties
  get id() { return this.fintoc?.id || ''; }
  get name() { return this.fintoc?.name || ''; }
  get type() { return this.fintoc?.type || ''; }
  get balance() { return this.fintoc?.balance || 0; }
  get currency() { return this.fintoc?.currency || ''; }
  get institutionName() { return this.institution?.name || 'Unknown'; }
  get displayName() { return `${this.institutionName} - ${this.name}`; }

  /**
   * Converts Fintoc account type to Actual account type
   * @returns {string} Actual account type
   */
  getActualAccountType() {
    const typeMap = {
      'checking_account': 'checking',
      'sight_account': 'checking',
      'savings_account': 'savings',
      'line_of_credit': 'credit',
      'credit_card': 'credit',
    };
    return typeMap[this.type] || 'other';
  }

  /**
   * Creates data structure for Actual account creation
   * @returns {Object} Account data for Actual API
   */
  toActualFormat() {
    return {
      name: this.displayName,
      type: this.getActualAccountType(),
    };
  }

  /**
   * Serializes account for storage
   * @returns {Object} Serialized account data
   */
  toJSON() {
    return {
      fintocId: this.id,
      name: this.name,
      type: this.type,
      balance: this.balance,
      currency: this.currency,
      actualId: this.actualId,
      institutionName: this.institutionName
    };
  }

  /**
   * Creates account from Fintoc data
   * @param {Object} data - Fintoc account data
   * @returns {Account} New account instance
   */
  static fromFintocData(data) {
    return new Account(data.account, data.institution);
  }

  /**
   * Reconstructs account from saved JSON
   * @param {Object} data - JSON data
   * @param {Array} allFintocAccounts - All available Fintoc accounts
   * @returns {Account} Reconstructed account
   */
  static fromJSON(data, allFintocAccounts = []) {
    // Try to find matching Fintoc account
    const match = allFintocAccounts.find(acc => acc.account.id === data.fintocId);

    if (match) {
      const account = Account.fromFintocData(match);
      account.actualId = data.actualId;
      return account;
    }

    // Otherwise, create from saved data
    return new Account(
      {
        id: data.fintocId,
        name: data.name,
        type: data.type,
        balance: data.balance,
        currency: data.currency
      },
      { name: data.institutionName },
      data.actualId
    );
  }
}

/**
 * Manages budget and account mappings
 */
class BudgetManager {
  /**
   * @param {string} budgetName - Budget name
   */
  constructor(budgetName) {
    this.budgetName = budgetName;
    this.accounts = [];
  }

  /**
   * Adds account to the budget
   * @param {Account} account - Account to add
   */
  addAccount(account) {
    this.accounts.push(account);
  }

  /**
   * Checks if budget already has an account with given Fintoc ID
   * @param {string} fintocId - Fintoc account ID
   * @returns {boolean} True if account exists
   */
  hasAccount(fintocId) {
    return this.accounts.some(acc => acc.id === fintocId);
  }

  /**
   * Gets account by Fintoc ID
   * @param {string} fintocId - Fintoc account ID
   * @returns {Account|undefined} Account if found
   */
  getAccount(fintocId) {
    return this.accounts.find(acc => acc.id === fintocId);
  }

  /**
   * Saves budget data to JSON file
   * @param {string} filePath - Path to save to
   * @returns {Promise<boolean>} Success status
   */
  async save(filePath) {
    return saveToJsonFile(filePath, {
      budgetName: this.budgetName,
      accounts: this.accounts.map(account => account.toJSON())
    });
  }

  /**
   * Loads budget from JSON file
   * @param {string} filePath - Path to load from
   * @param {string} budgetName - Default budget name
   * @param {Array} fintocAccounts - Fintoc accounts for matching
   * @returns {Promise<BudgetManager>} Budget manager instance
   */
  static async load(filePath, budgetName, fintocAccounts = []) {
    try {
      if (!existsSync(filePath)) {
        logger.info(`Budget file not found at ${filePath}, creating new budget manager`);
        return new BudgetManager(budgetName);
      }

      const fileContent = await readFile(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      const manager = new BudgetManager(data.budgetName || budgetName);

      if (data.accounts && Array.isArray(data.accounts)) {
        data.accounts.forEach(accountData => {
          manager.addAccount(Account.fromJSON(accountData, fintocAccounts));
        });
      }

      logger.info(`Loaded budget ${manager.budgetName} with ${manager.accounts.length} accounts`);
      return manager;
    } catch (error) {
      logger.error(`Failed to load budget from ${filePath}`, error);
      return new BudgetManager(budgetName);
    }
  }
}

// ====== SERVICE CLASSES ======
/**
 * Service for interacting with Fintoc API
 */
class FintocService {
  /**
   * @param {string} apiKey - Fintoc API key
   */
  constructor(apiKey) {
    this.client = new Fintoc(apiKey);
    logger.info("Fintoc service initialized");
  }

  /**
   * Fetches all accounts from multiple Fintoc links
   * @param {string[]} tokens - Link tokens
   * @returns {Promise<Array>} Array of accounts
   */
  async getAccounts(tokens) {
    // Get links
    const links = await Promise.all(tokens.map(async (token) => {
      return await safeExecute(
        async () => {
          const link = await this.client.links.get(token);
          logger.info(`Link fetched: ${token}`);
          return link;
        },
        `Failed to fetch link: ${token}`
      );
    }));

    // Get accounts from links
    const accountsArrays = await Promise.all(
      links.filter(Boolean).map(async (link) => {
        return await safeExecute(
          async () => {
            const accounts = await link.accounts.all({ lazy: false });
            return accounts.map(account => ({
              account: account,
              institution: link.institution
            }));
          },
          `Error fetching accounts for link ${link.token}`,
          []
        );
      })
    );

    return accountsArrays.flat();
  }

  /**
   * Fetches transactions/movements for an account
   * @param {Object} account - Fintoc account
   * @param {string} since - Date to fetch from (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of transactions
   */
  async getMovements(account, since = "2020-01-01") {
    return await safeExecute(
      async () => {
        logger.info(`Fetching movements for account: ${account.account.id}`);
        const movements = await account.account.movements.all({ lazy: false, since });
        logger.info(`Fetched ${movements.length} movements`);
        return movements;
      },
      `Error fetching movements for account ${account.account.id}`,
      []
    );
  }
}

/**
 * Service for interacting with Actual Budget API
 */
class ActualService {
  /**
   * @param {string} dataDir - Actual data directory
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  /**
   * Initializes the Actual API
   */
  async initialize() {
    await actual_api.init({ dataDir: this.dataDir });
    logger.info("Actual API initialized");
  }

  /**
   * Shuts down the Actual API
   */
  async shutdown() {
    await actual_api.shutdown();
    logger.info("Actual API shut down");
  }

  /**
   * Loads a budget in Actual
   * @param {string} budgetName - Budget name
   * @returns {Promise<string|null>} Budget ID if successful
   */
  async loadBudget(budgetName) {
    try {
      const budgets = await actual_api.getBudgets();
      const budget = budgets.find(b => b.name === budgetName);
      if (budget) {
        await actual_api.loadBudget(budget.id);
        logger.info(`Loaded budget: ${budgetName}`);
        return budget.id;
      } else {
        logger.warn(`Budget not found: ${budgetName}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error loading budget: ${budgetName}`, error);
      throw error;
    }
  }

  /**
   * Checks if a budget exists
   * @param {string} budgetName - Budget name
   * @returns {Promise<boolean>} True if budget exists
   */
  async budgetExists(budgetName) {
    try {
      const budgets = await actual_api.getBudgets();
      return budgets.some(budget => budget.name === budgetName);
    } catch (error) {
      logger.error(`Error checking budget existence: ${budgetName}`, error);
      return false;
    }
  }

  /**
   * Creates an account in Actual
   * @param {Account} account - Account to create
   * @returns {Promise<Account>} Updated account with Actual ID
   */
  async createAccount(account) {
    try {
      const accountData = account.toActualFormat();
      const accountId = await actual_api.createAccount(accountData);
      account.actualId = accountId;
      logger.info(`Created account: ${accountId} (${account.displayName})`);
      return account;
    } catch (error) {
      logger.error(`Error creating account: ${account.name}`, error);
      throw error;
    }
  }

  /**
   * Adds or imports transactions to an account
   * @param {string} accountId - Actual account ID
   * @param {Array} movements - Fintoc movements/transactions
   * @param {boolean} isUpdate - True for import, false for add
   * @returns {Promise<number>} Number of transactions processed
   */
  async addTransactions(accountId, movements, isUpdate = false) {
    try {
      // Convert Fintoc movements to Actual transactions
      const transactions = movements
        .map(movement => ({
          account: accountId,
          date: movement.post_date,
          amount: typeof movement.amount === 'number' ? movement.amount * 100 : 0,
          imported_payee: String(movement.description || ''),
          imported_id: movement.id || '',
          notes: String(movement.description || '')
        }))
        .filter(Boolean);

      if (transactions.length === 0) {
        logger.info(`No transactions to add for account: ${accountId}`);
        return 0;
      }

      // Use the appropriate API method based on whether this is an update
      if (isUpdate) {
        await actual_api.importTransactions(accountId, transactions);
      } else {
        await actual_api.addTransactions(accountId, transactions);
      }

      const action = isUpdate ? 'Imported' : 'Added';
      logger.info(`${action} ${transactions.length} transactions for account: ${accountId}`);
      return transactions.length;
    } catch (error) {
      logger.error(`Error processing transactions for account: ${accountId}`, error);
      return 0;
    }
  }
}

// ====== CORE SYNC FUNCTIONS ======
/**
 * Main function to sync Fintoc data to Actual
 * @param {boolean} isUpdate - Whether to update existing or create new budget
 * @returns {Promise<void>}
 */
async function syncFintocToActual(isUpdate = false) {
  const fintoc = new FintocService(CONFIG.FINTOC_API_KEY);
  const actual = new ActualService(CONFIG.ACTUAL_DATA_DIR);

  try {
    // Initialize Actual API
    await actual.initialize();

    // Fetch all Fintoc accounts
    logger.info("Fetching Fintoc accounts...");
    const fintocAccounts = await fintoc.getAccounts(CONFIG.LINK_TOKENS);
    logger.info(`Found ${fintocAccounts.length} accounts in Fintoc`);

    if (isUpdate) {
      await updateExistingBudget(fintoc, actual, fintocAccounts);
    } else {
      await createNewBudget(fintoc, actual, fintocAccounts);
    }
  } catch (error) {
    logger.error("Sync process failed", error);
  } finally {
    await actual.shutdown();
  }
}

/**
 * Updates an existing budget with new Fintoc data
 * @param {FintocService} fintoc - Fintoc service
 * @param {ActualService} actual - Actual service
 * @param {Array} fintocAccounts - Fintoc accounts
 * @returns {Promise<void>}
 */
async function updateExistingBudget(fintoc, actual, fintocAccounts) {
  logger.info("Updating existing budget...");

  // Load saved account mappings
  const budgetManager = await BudgetManager.load(
    CONFIG.ACCOUNTS_JSON_FILE,
    CONFIG.ACTUAL_BUDGET_NAME,
    fintocAccounts
  );

  // Load the budget in Actual
  await actual.loadBudget(CONFIG.ACTUAL_BUDGET_NAME);

  // Create any new accounts that aren't in our mapping yet
  for (const fintocData of fintocAccounts) {
    const fintocId = fintocData.account.id;

    if (!budgetManager.hasAccount(fintocId)) {
      try {
        const account = Account.fromFintocData(fintocData);
        const createdAccount = await actual.createAccount(account);
        budgetManager.addAccount(createdAccount);
        logger.info(`Created new account: ${createdAccount.displayName}`);
      } catch (error) {
        logger.error(`Failed to create account for ${fintocId}`, error);
      }
    }
  }

  // Update transactions for all accounts
  let totalTransactions = 0;
  for (const account of budgetManager.accounts) {
    const matchingFintocData = fintocAccounts.find(data => data.account.id === account.id);

    if (matchingFintocData) {
      const movements = await fintoc.getMovements(
        { account: matchingFintocData.account },
        CONFIG.MOVEMENTS_SINCE
      );
      const count = await actual.addTransactions(account.actualId, movements, true);
      totalTransactions += count;
    } else {
      logger.warn(`No matching Fintoc data for account ${account.id}, skipping transactions`);
    }
  }

  // Save updated account mapping
  await budgetManager.save(CONFIG.ACCOUNTS_JSON_FILE);
  logger.info(`Budget update completed with ${totalTransactions} total transactions processed`);
}

/**
 * Creates a new budget with Fintoc data
 * @param {FintocService} fintoc - Fintoc service
 * @param {ActualService} actual - Actual service
 * @param {Array} fintocAccounts - Fintoc accounts
 * @returns {Promise<void>}
 */
async function createNewBudget(fintoc, actual, fintocAccounts) {
  logger.info("Creating new budget...");

  await actual_api.runImport(CONFIG.ACTUAL_BUDGET_NAME, async () => {
    const budgetManager = new BudgetManager(CONFIG.ACTUAL_BUDGET_NAME);
    let totalAccounts = 0;
    let totalTransactions = 0;

    // Create all accounts and add transactions
    for (const fintocData of fintocAccounts) {
      try {
        // Create account
        const account = Account.fromFintocData(fintocData);
        const createdAccount = await actual.createAccount(account);
        budgetManager.addAccount(createdAccount);
        totalAccounts++;
        
        // Add transactions
        const movements = await fintoc.getMovements(
          { account: fintocData.account },
          CONFIG.MOVEMENTS_SINCE
        );
        const count = await actual.addTransactions(createdAccount.actualId, movements, false);
        totalTransactions += count;
      } catch (error) {
        logger.error(`Failed to process account: ${fintocData.account.id}`, error);
      }
    }

    // Save account mapping for future updates
    await budgetManager.save(CONFIG.ACCOUNTS_JSON_FILE);
    logger.info(`Created ${totalAccounts} accounts with ${totalTransactions} transactions`);
  });
  
  logger.info("New budget creation completed");
}

// ====== APPLICATION ENTRY POINT ======
/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info("Starting Fintoc to Actual sync");
    const actualService = new ActualService(CONFIG.ACTUAL_DATA_DIR);
    
    // Check if budget already exists
    await actualService.initialize();
    const budgetExists = await actualService.budgetExists(CONFIG.ACTUAL_BUDGET_NAME);
    // await actualService.shutdown();
    
    // Either update existing or create new budget
    await syncFintocToActual(budgetExists);
    
    logger.info("Sync completed successfully");
  } catch (error) {
    logger.error("Unhandled error in main process", error);
  }
}

// Start the application
main().catch(error => {
  logger.error("Application failed", error);
});