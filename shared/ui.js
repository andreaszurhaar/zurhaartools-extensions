// Shared UI helpers — used by all credit-based extensions
// Loaded via <script> tag before extension-specific code
//
// Expects these elements to exist in the HTML:
//   #state-welcome, #state-initial, #state-loading, #state-results,
//   #state-error, #state-no-credits, #credits-display,
//   #license-error, #error-message

const stateWelcome = document.getElementById('state-welcome');
const stateInitial = document.getElementById('state-initial');
const stateLoading = document.getElementById('state-loading');
const stateResults = document.getElementById('state-results');
const stateError = document.getElementById('state-error');
const stateNoCredits = document.getElementById('state-no-credits');

const ALL_STATES = [stateWelcome, stateInitial, stateLoading, stateResults, stateError, stateNoCredits];

function showState(state) {
  ALL_STATES.forEach(el => { if (el) el.classList.add('hidden'); });
  // Also hide extension-specific states (e.g. state-no-job)
  document.querySelectorAll('.state').forEach(el => el.classList.add('hidden'));
  state.classList.remove('hidden');
}

function updateCreditsDisplay(count) {
  const el = document.getElementById('credits-display');
  if (count !== null && count !== undefined && count >= 0) {
    el.textContent = `${count} scan${count !== 1 ? 's' : ''} remaining`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function showLicenseError(message) {
  const el = document.getElementById('license-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideLicenseError() {
  document.getElementById('license-error').classList.add('hidden');
}

function showErrorState(message) {
  document.getElementById('error-message').textContent =
    message || 'Something went wrong. Please try again.';
  showState(stateError);
}
