Crafted with care and a touch of magic using GitHub Copilot. ✨

---
# Fintoc -> Actual Budget

This tool is designed to help you manage your finances by integrating [Fintoc](https://fintoc.com/) with [Actual Budget](https://actualbudget.org). It allows you to fetch transactions from Fintoc and import them into Actual Budget.

## Prerequisites
- Node.js installed on your machine.
- A Fintoc account with access to your bank transactions via their API.
  - You need to create a Fintoc API key and link your bank account to Fintoc.
  - You can find instructions on how to do this in the [Fintoc documentation](https://docs.fintoc.com/).
  - Save your Fintoc API key in a `.env` file in the root of the project. The same for the Fintoc Link Tokens.
  - KEEP THEM SECRET! Do not share them with anyone or commit them to version control.
- An Actual Budget app running on your machine.
  - You can find instructions on how to do this in the [Actual Budget documentation](https://actualbudget.org/docs/).
  - Note that the app must be running in local. In particular, I'm using the electron based apps. Probably some modifications would be needed to run it in the web version.

## Installation

Run:

```bash
npm install
```

## Usage

Copy the `.env.example` file to `.env` and fill in the required values.

```bash
cp .env.example .env
```

Run:

```bash
npm start
```

The first time you run the script, it will create a new budget in Actual Budget with the desired name and import the transactions from Fintoc. It will create some files with the association between the Fintoc Accounts and the Actual Budget Accounts.

The following time you run the script it will fetch the transactions and update the already created budget.

### New Transactions

It seems that when trying to fetch new transactions from Fintoc, it will return the already fetched ones, at least when using a free account. I found that a way to bring truly new transactions is to deactivate the Fintoc Link Token and then reactivate it. That way you can update your transactions in Actual Budget.

## Tips and Tricks
- On your Actual Budget app settings:
  - Change formatting of Numbers to 1.000 instead of 1,000.
  - Change formatting of Numbers to "Hide decimal places".
  - Change formatting of Dates to DD/MM/YYYY instead of MM/DD/YYYY if you like.
  - Change formatting of the first day of the week to Monday instead of Sunday if you like.

# Roadmap

I would like to:
- Create some initial categories for the transactions.
- Create a way to automatically categorize transactions based on their description.
- Properly handle the Payees of the transactions. I decided to ignore them for now, but it would be nice to have them properly managed.

# Notes
- I barely know any JavaScript or Node, so this code was done with a lot of help from Copilot (vibecoding vibes only 🤙).