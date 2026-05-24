
const translations={
en:{
eyebrow:"Investment Calculator",
heroTitle:"Compound interest made simple.",
heroSubtitle:"Set your monthly contribution, investment periods and expected yearly return.",
heroResult:"Estimated value",
initialDeposit:"Initial deposit",
monthlyDeposit:"Monthly contribution",
annualReturn:"Annual return (%)",
investmentLength:"Investment length (years)",
notice:"Special periods override the default monthly contribution during selected years.",
specialPeriods:"Special periods",
specialPeriodsSub:"Example: invest 4 000 Kč/month from year 3 to year 5.",
addPeriod:"+ Add period",
calculate:"Calculate",
finalValue:"Final value",
invested:"Invested",
profit:"Profit",
period:"Period",
amount:"Monthly amount",
from:"From year",
to:"To year",
delete:"Delete"
},
cs:{
eyebrow:"Investiční kalkulačka",
heroTitle:"Složené úročení jednoduše.",
heroSubtitle:"Nastav měsíční vklad, investiční období a očekávané roční zhodnocení.",
heroResult:"Odhadovaná hodnota",
initialDeposit:"Počáteční vklad",
monthlyDeposit:"Měsíční vklad",
annualReturn:"Roční zhodnocení (%)",
investmentLength:"Délka investice (roky)",
notice:"Speciální období přepíšou hlavní měsíční vklad v daném rozsahu let.",
specialPeriods:"Speciální období",
specialPeriodsSub:"Například: investuj 4 000 Kč měsíčně od 3. do 5. roku.",
addPeriod:"+ Přidat období",
calculate:"Spočítat",
finalValue:"Konečný stav",
invested:"Vloženo",
profit:"Zisk",
period:"Období",
amount:"Měsíční částka",
from:"Od roku",
to:"Do roku",
delete:"Smazat"
}
};

let currentLang="en";
let periodId=0;

function t(key){
return translations[currentLang][key];
}

function applyTranslations(){
document.querySelectorAll("[data-i18n]").forEach(el=>{
el.textContent=t(el.dataset.i18n);
});
}

document.getElementById("languageSwitcher").addEventListener("change",(e)=>{
currentLang=e.target.value;
applyTranslations();
refreshSummaries();
});

document.getElementById("addPeriodBtn").addEventListener("click",addPeriod);

function addPeriod(){
periodId++;

const el=document.createElement("details");
el.className="period";
el.open=true;

el.innerHTML=`
<summary></summary>
<div class="period-content">
<label class="field">
<span>${t("amount")}</span>
<input class="period-amount" type="number" value="4000">
</label>

<label class="field">
<span>${t("from")}</span>
<input class="period-from" type="number" value="3">
</label>

<label class="field">
<span>${t("to")}</span>
<input class="period-to" type="number" value="5">
</label>

<button class="remove">${t("delete")}</button>
</div>
`;

el.querySelector(".remove").addEventListener("click",()=>{
el.remove();
refreshSummaries();
});

el.querySelectorAll("input").forEach(input=>{
input.addEventListener("input",refreshSummaries);
});

document.getElementById("periodsContainer").appendChild(el);

refreshSummaries();
}

function refreshSummaries(){
document.querySelectorAll(".period").forEach((period,index)=>{
const amount=period.querySelector(".period-amount").value;
const from=period.querySelector(".period-from").value;
const to=period.querySelector(".period-to").value;

period.querySelector("summary").textContent=
`${t("period")} ${index+1}: ${amount} Kč (${from}-${to})`;
});
}

document.getElementById("calculateBtn").addEventListener("click",calculate);

function calculate(){
const initial=Number(document.getElementById("initialDeposit").value);
const monthly=Number(document.getElementById("baseMonthlyDeposit").value);
const rate=Number(document.getElementById("annualRate").value)/100/12;
const years=Number(document.getElementById("totalYears").value);

const months=years*12;

const deposits=Array(months).fill(monthly);

document.querySelectorAll(".period").forEach(period=>{
const amount=Number(period.querySelector(".period-amount").value);
const from=Number(period.querySelector(".period-from").value);
const to=Number(period.querySelector(".period-to").value);

for(let i=(from-1)*12;i<to*12;i++){
deposits[i]=amount;
}
});

let balance=initial;
let invested=initial;

for(let i=0;i<months;i++){
balance*=1+rate;
balance+=deposits[i];
invested+=deposits[i];
}

const profit=balance-invested;

document.getElementById("heroValue").textContent=format(balance);
document.getElementById("finalValue").textContent=format(balance);
document.getElementById("totalInvested").textContent=format(invested);
document.getElementById("interestEarned").textContent=format(profit);

document.getElementById("results").classList.remove("hidden");
}

function format(v){
return new Intl.NumberFormat(currentLang==="cs"?"cs-CZ":"en-US",{
maximumFractionDigits:0
}).format(v)+" Kč";
}

applyTranslations();
addPeriod();
