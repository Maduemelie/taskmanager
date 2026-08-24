/* js/tests/runner.js */

let suites = [];
let currentSuite = null;
let currentTest = null;
let assertionsCount = 0;
let assertionsPassed = 0;
let failures = [];

/**
 * Declares a test suite block.
 */
export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  
  const parentSuite = currentSuite;
  currentSuite = suite;
  fn();
  currentSuite = parentSuite;
}

/**
 * Declares an individual test block inside a suite.
 */
export function it(name, fn) {
  if (!currentSuite) {
    throw new Error(`"it" must be called inside a "describe" block.`);
  }
  currentSuite.tests.push({ name, fn });
}

/**
 * Asserts expectations.
 */
export function expect(actual) {
  assertionsCount++;
  
  const reportPass = () => {
    assertionsPassed++;
  };

  const reportFail = (message) => {
    const errorMsg = `Assertion Failed: ${message}\nActual: ${JSON.stringify(actual)}\nTest: ${currentSuite ? currentSuite.name : 'Unknown'} > ${currentTest ? currentTest.name : 'Unknown'}`;
    throw new Error(errorMsg);
  };

  return {
    toBe(expected) {
      if (actual === expected) {
        reportPass();
      } else {
        reportFail(`Expected ${expected}, but got ${actual}`);
      }
    },
    
    toEqual(expected) {
      const actStr = JSON.stringify(actual);
      const expStr = JSON.stringify(expected);
      if (actStr === expStr) {
        reportPass();
      } else {
        reportFail(`Expected deep match of ${expStr}, but got ${actStr}`);
      }
    },

    toBeGreaterThan(expected) {
      if (actual > expected) {
        reportPass();
      } else {
        reportFail(`Expected ${actual} to be greater than ${expected}`);
      }
    },

    toBeLessThan(expected) {
      if (actual < expected) {
        reportPass();
      } else {
        reportFail(`Expected ${actual} to be less than ${expected}`);
      }
    },

    toBeTruthy() {
      if (actual) {
        reportPass();
      } else {
        reportFail(`Expected truthy value, but got ${actual}`);
      }
    },

    toBeFalsy() {
      if (!actual) {
        reportPass();
      } else {
        reportFail(`Expected falsy value, but got ${actual}`);
      }
    }
  };
}

/**
 * Runs all registered tests, reports output to console and page DOM.
 */
export async function runAllTests() {
  console.log('%c[TEST RUNNER] Starting Suite Execution...', 'font-weight: bold; color: #4A90E2; font-size: 1.1rem;');
  const startTime = performance.now();
  
  assertionsCount = 0;
  assertionsPassed = 0;
  failures = [];
  
  let testsCount = 0;
  let testsPassed = 0;
  
  const reportEl = document.getElementById('test-report');
  if (reportEl) {
    reportEl.innerHTML = '<h2>Running Tests...</h2>';
  }

  for (const suite of suites) {
    console.log(`%cSuite: ${suite.name}`, 'font-weight: bold; color: #E8703A;');
    
    const suiteDiv = document.createElement('div');
    suiteDiv.style.marginBottom = 'var(--spacing-md)';
    suiteDiv.innerHTML = `<h3 style="margin-bottom:8px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">${suite.name}</h3>`;
    if (reportEl) reportEl.appendChild(suiteDiv);

    for (const test of suite.tests) {
      testsCount++;
      currentSuite = suite;
      currentTest = test;
      
      const testItem = document.createElement('div');
      testItem.style.paddingLeft = 'var(--spacing-md)';
      testItem.style.fontSize = '0.9rem';
      testItem.style.marginBottom = '4px';

      try {
        await test.fn();
        testsPassed++;
        console.log(`  %c✓ ${test.name}`, 'color: #5B8C5A;');
        testItem.innerHTML = `<span style="color:#5B8C5A;">✓</span> ${test.name}`;
      } catch (err) {
        const errorDetail = err && err.message ? err.message : String(err);
        failures.push(`${currentSuite ? currentSuite.name : 'Unknown'} > ${test.name}: ${errorDetail}`);
        console.log(`  %c✗ ${test.name}`, 'color: #D32F2F;');
        console.error(errorDetail);
        testItem.innerHTML = `<span style="color:#D32F2F; font-weight:bold;">✗ ${test.name}</span><pre style="color:#D32F2F; margin: 4px 0 12px 12px; font-size:0.8rem; overflow-x:auto;">${errorDetail}</pre>`;
      }
      
      if (reportEl) suiteDiv.appendChild(testItem);
    }
  }

  const elapsed = (performance.now() - startTime).toFixed(1);
  const statusColor = failures.length === 0 ? '#5B8C5A' : '#D32F2F';

  console.log(
    `%c[TEST RUNNER] Finished in ${elapsed}ms. Tests: ${testsPassed}/${testsCount} passed. Assertions: ${assertionsPassed}/${assertionsCount} passed.`,
    `font-weight: bold; color: ${statusColor}; font-size: 1.05rem;`
  );

  if (reportEl) {
    const summary = document.createElement('div');
    summary.style.marginTop = 'var(--spacing-xl)';
    summary.style.padding = 'var(--spacing-md)';
    summary.style.borderRadius = 'var(--radius-md)';
    summary.style.backgroundColor = failures.length === 0 ? '#5B8C5A22' : '#D32F2F22';
    summary.style.border = `1px solid ${statusColor}`;
    summary.innerHTML = `
      <h4 style="color:${statusColor}; font-weight:800; margin-bottom:4px;">
        ${failures.length === 0 ? 'All Tests Passed 🎉' : 'Some Tests Failed ❌'}
      </h4>
      <p style="font-size:0.85rem; margin:0;">
        Completed in <strong>${elapsed}ms</strong>. Tests: <strong>${testsPassed}/${testsCount}</strong>. Assertions: <strong>${assertionsPassed}/${assertionsCount}</strong>.
      </p>
    `;
    reportEl.insertBefore(summary, reportEl.firstChild);
  }
}
