let periodId = 0;

const form = document.getElementById("calculatorForm");
const periodsContainer = document.getElementById("periodsContainer");
const addPeriodBtn = document.getElementById("addPeriodBtn");

addPeriodBtn.addEventListener("click", () => addPeriod());
form.addEventListener("submit", (event) => {
  event.preventDefault();
  calculate();
});

function addPeriod(values = {}) {
  periodId += 1;

  const details = document.createElement("details");
  details.className = "period";
  details.open = true;
  details.dataset.id = String(periodId);

  details.innerHTML = `
    <summary>Období ${periodId}</summary>
    <div class="period-content">
      <div class="period-grid">
        <label class="field">
          <span>Měsíční vklad v období</span>
          <div class="input-wrap">
            <input class="period-amount" type="number" min="0" step="any" value="${values.amount ?? ""}" placeholder="např. 4000">
            <em>Kč</em>
          </div>
        </label>

        <label class="field">
          <span>Od roku investování</span>
          <div class="input-wrap">
            <input class="period-from" type="number" min="1" step="any" value="${values.from ?? ""}" placeholder="např. 3">
            <em>rok</em>
          </div>
        </label>

        <label class="field">
          <span>Do roku investování</span>
          <div class="input-wrap">
            <input class="period-to" type="number" min="1" step="any" value="${values.to ?? ""}" placeholder="např. 5">
            <em>rok</em>
          </div>
        </label>

        <button class="remove" type="button">Smazat</button>
      </div>
    </div>
  `;

  details.querySelector(".remove").addEventListener("click", () => {
    details.remove();
    refreshSummaries();
  });

  details.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", refreshSummaries);
  });

  periodsContainer.appendChild(details);
  refreshSummaries();
}

function refreshSummaries() {
  [...periodsContainer.querySelectorAll(".period")].forEach((period, index) => {
    const amount = Number(period.querySelector(".period-amount").value);
    const from = Number(period.querySelector(".period-from").value);
    const to = Number(period.querySelector(".period-to").value);

    let text = `Období ${index + 1}`;
    if (amount && from && to) {
      text += `: ${formatShort(amount)} Kč / měsíc od ${from}. do ${to}. roku`;
    }

    period.querySelector("summary").firstChild.textContent = text;
  });
}

function calculate() {
  const initialDeposit = getNumber("initialDeposit");
  const baseMonthlyDeposit = getNumber("baseMonthlyDeposit");
  const annualRate = getNumber("annualRate");
  const totalYears = getNumber("totalYears");

  if (totalYears <= 0) {
    alert("Doba investování musí být větší než 0.");
    return;
  }

  const totalMonths = Math.round(totalYears * 12);
  const monthlyRate = annualRate / 100 / 12;
  const monthlyDeposits = Array(totalMonths).fill(baseMonthlyDeposit);

  const periods = [...periodsContainer.querySelectorAll(".period")].map((period) => ({
    amount: Number(period.querySelector(".period-amount").value),
    from: Number(period.querySelector(".period-from").value),
    to: Number(period.querySelector(".period-to").value),
  }));

  for (const period of periods) {
    if (!period.amount || !period.from || !period.to) continue;

    if (period.to < period.from) {
      alert("U jednoho období je rok 'do' menší než rok 'od'.");
      return;
    }

    const startMonth = Math.max(0, Math.round((period.from - 1) * 12));
    const endMonth = Math.min(totalMonths, Math.round(period.to * 12));

    for (let month = startMonth; month < endMonth; month++) {
      monthlyDeposits[month] = period.amount;
    }
  }

  let balance = initialDeposit;
  let totalInvested = initialDeposit;

  for (let month = 0; month < totalMonths; month++) {
    balance = balance * (1 + monthlyRate);
    balance += monthlyDeposits[month];
    totalInvested += monthlyDeposits[month];
  }

  const interest = balance - totalInvested;

  document.getElementById("heroValue").textContent = `${formatMoney(balance)} Kč`;
  document.getElementById("finalValue").textContent = `${formatMoney(balance)} Kč`;
  document.getElementById("totalInvested").textContent = `${formatMoney(totalInvested)} Kč`;
  document.getElementById("interestEarned").textContent = `${formatMoney(interest)} Kč`;
  document.getElementById("results").classList.remove("hidden");
}

function getNumber(id) {
  return Number(document.getElementById(id).value) || 0;
}

function formatMoney(value) {
  return value.toLocaleString("cs-CZ", {
    maximumFractionDigits: 0,
  });
}

function formatShort(value) {
  return value.toLocaleString("cs-CZ", {
    maximumFractionDigits: 0,
  });
}

// Ukázkové období, aby uživatel hned viděl princip.
addPeriod({ amount: 4000, from: 3, to: 5 });
