import { totalMonths } from '../model/scenario'
import { baseAmount, depositFee, feeDrag, grow, nextYearContribution, perYear, realOf, timingDifference } from './examples'
import type { HelpContent, HelpCtx } from './types'
import { plannedIncome } from '../model/retirement'

const PER: Record<string, string> = { weekly: 'týden', monthly: 'měsíc', quarterly: 'čtvrtletí', semiannual: 'pololetí', annual: 'rok' }
const EVERY: Record<string, string> = { weekly: 'každý týden', monthly: 'každý měsíc', quarterly: 'každé čtvrtletí', semiannual: 'každé pololetí', annual: 'každý rok' }
const rate = (c: HelpCtx) => (c.s.annualReturn > 0 ? c.s.annualReturn : 7)
const infl = (c: HelpCtx) => (c.s.inflationEnabled && c.s.inflation > 0 ? c.s.inflation : 2.5)
const monthly = (c: HelpCtx) => (c.s.contribMode === 'constant' && c.s.constant.amount > 0 ? c.s.constant.amount : baseAmount(c.s.currency, 5000))
const roky = (n: number) => `${n} ${n === 1 ? 'rok' : n >= 2 && n <= 4 ? 'roky' : 'let'}`

export const helpCs: HelpContent = {
  /* ───────── Hlavní kalkulačka ───────── */
  currency: (c) => ({
    title: 'Měna',
    what: 'Měna, ve které je celý plán vyjádřen — CZK, EUR nebo USD.',
    how: 'Přepnutí mění jen jednotku. Všechny částky zůstanou přesně tak, jak jste je zadali; nic se nepřepočítává kurzem.',
    example: `${c.money(baseAmount(c.s.currency))} zůstane po přepnutí stejným číslem, jen v jiné měně.`,
    limit: 'Chcete-li porovnat plány v různých měnách, zadejte částky sami v jedné měně.',
  }),
  initial: (c) => ({
    title: 'Počáteční vklad',
    what: 'Peníze, které investujete jednorázově hned na začátku.',
    how: 'Zhodnocují se po celou dobu investice, takže ze složeného úročení těží nejvíc.',
    example: `${c.money(baseAmount(c.s.currency))} při ${c.pct(rate(c))} ročně vzroste za 10 let zhruba na ${c.money(grow(baseAmount(c.s.currency), rate(c), 120))}, bez dalších vkladů a poplatků.`,
  }),
  contribution: (c) => {
    const s = c.s
    const ex =
      s.contribMode === 'constant' && s.constant.amount > 0
        ? `Nyní investujete ${c.money(s.constant.amount)} ${EVERY[s.constant.frequency]} — to je ${c.money(perYear(s.constant.amount, s.constant.frequency))} ročně před případným navyšováním.`
        : `Například ${c.money(monthly(c))} měsíčně dělá ${c.money(perYear(monthly(c), 'monthly'))} za rok.`
    return {
      title: 'Pravidelný vklad',
      what: 'Částka, kterou do investice opakovaně přidáváte, třeba každý měsíc.',
      how: 'Četnost vedle částky určuje, jak často investujete: týdně je 52 vkladů ročně, měsíčně 12, čtvrtletně 4. Volbou „Mění se v čase“ naplánujete různé částky pro různá životní období.',
      example: ex,
    }
  },
  frequency: (c) => ({
    title: 'Četnost vkladů',
    what: 'Jak často se pravidelná částka investuje.',
    how: 'Týdně znamená 52 vkladů ročně, měsíčně 12, čtvrtletně 4, pololetně 2 a ročně 1. Každý vklad se započítá k přesnému datu.',
    example: `${c.money(baseAmount(c.s.currency, 1000))} týdně je ${c.money(perYear(baseAmount(c.s.currency, 1000), 'weekly'))} ročně; stejná částka měsíčně ${c.money(perYear(baseAmount(c.s.currency, 1000), 'monthly'))}.`,
  }),
  timeline: (c) => ({
    title: 'Vklady, které se mění v čase',
    what: 'Plán po sobě jdoucích období, každé s vlastní částkou a četností.',
    how: 'Období na sebe navazují bez mezer a překryvů. Kliknutím na období upravíte částku, četnost nebo poslední rok, případně ho pozastavíte, zduplikujete či odstraníte.',
    example: `Roky 1–5: ${c.money(baseAmount(c.s.currency, 2000))} měsíčně, roky 6–15: ${c.money(baseAmount(c.s.currency, 5000))}, roky 16–30: ${c.money(baseAmount(c.s.currency, 12000))}.`,
    more: 'Málokdo investuje desítky let stejnou částku. Vklady obvykle rostou s příjmem a během rodičovské nebo splácení hypotéky se mohou na čas zastavit. Rozdělení na období dává mnohem realističtější odhad než jedna stálá částka.',
  }),
  growth: (c) => {
    const g = c.s.growthMode === 'custom' ? c.s.growthRate : c.s.growthMode === 'inflation' ? infl(c) : 5
    const a = monthly(c)
    return {
      title: 'Roční navyšování',
      what: 'Jednou ročně automaticky zvýší všechny pravidelné vklady.',
      how: '„O inflaci“ je zvyšuje o míru inflace, takže v dnešních cenách zůstávají stejné. „Žádné“ drží stále stejnou nominální částku, jejíž kupní síla pomalu klesá.',
      example: `${c.money(a)} měsíčně s navýšením o ${c.pct(g)} bude ve druhém roce ${c.money(nextYearContribution(a, g))} měsíčně.`,
    }
  },
  horizon: (c) => ({
    title: 'Doba investice',
    what: 'Jak dlouho peníze zůstanou investované — v letech a případně dalších měsících.',
    how: 'Čím delší doba, tím víc času má složené úročení; jeho účinek nejvíc roste v posledních letech.',
    example: `Váš plán teď trvá ${roky(c.s.horizonYears)}${c.s.horizonMonths ? ` a ${c.s.horizonMonths} měs.` : ''} (${totalMonths(c.s)} měsíců).`,
  }),
  return: (c) => ({
    title: 'Očekávané roční zhodnocení',
    what: 'Průměrný roční růst, který pro investici předpokládáte.',
    how: 'Počítá se jako efektivní roční sazba: celý rok růstu odpovídá přesně tomuto procentu, rovnoměrně rozloženému do měsíců.',
    example: `Při ${c.pct(rate(c))} by ${c.money(baseAmount(c.s.currency))} za jeden rok vzrostlo na ${c.money(grow(baseAmount(c.s.currency), rate(c)))}, bez vkladů a poplatků.`,
    limit: 'Skutečné trhy rok od roku kolísají. Výnos není zaručený — rozpětí možných výsledků ukazuje sekce Riziko.',
    more: 'Měsíční sazba se odvozuje jako (1 + R)^(1/12) − 1, nikoli R ÷ 12, takže 12 měsíců růstu dá přesně R. U širokých akciových portfolií se dlouhodobě často počítá se 4–8 % ročně, u dluhopisů či spoření s méně.',
  }),
  timing: (c) => {
    const d = timingDifference(monthly(c), rate(c))
    return {
      title: 'Načasování vkladů',
      what: 'Zda se každý vklad provede na začátku, nebo na konci svého období.',
      how: 'Vklad na začátku se během období zhodnocuje; vklad na konci se přičte až po zhodnocení za dané období.',
      example: `${c.money(monthly(c))} měsíčně po dobu jednoho roku při ${c.pct(rate(c))}: na začátku měsíce ${c.money(d.start)}, na konci měsíce ${c.money(d.end)}.`,
    }
  },

  /* ───────── Časová osa ───────── */
  periodFrequency: () => ({
    title: 'Četnost v tomto období',
    what: 'Jak často se částka tohoto období investuje.',
    how: 'Každé období může mít vlastní četnost — třeba nejdřív měsíčně a později jeden větší vklad ročně.',
  }),
  boundaries: () => ({
    title: 'Hranice období',
    what: 'Poslední rok tohoto období. Další období začíná následujícím rokem.',
    how: 'Změnou posunete hranici mezi tímto a dalším obdobím, takže se období nikdy nepřekrývají.',
    example: 'Posunete-li konec „Roky 1–10“ na rok 5, další období začne v roce 6.',
  }),
  paused: () => ({
    title: 'Pozastavené vklady',
    what: 'Období bez vkladů — například rodičovská dovolená nebo studijní volno.',
    how: 'Už investované peníze dál rostou; zastaví se jen nové vklady. Obnovením se vrátí původní částka.',
  }),
  gaps: () => ({
    title: 'Nepokryté roky',
    what: 'Roky v rámci doby investice, které žádné období nepokrývá.',
    how: 'V těchto letech se nevkládá nic. Prodlužte poslední období, nebo mezeru ponechte, pokud je záměrná.',
  }),

  /* ───────── Cíle ───────── */
  goal: () => ({
    title: 'Finanční cíl',
    what: 'Cílová částka, které chcete do určitého roku dosáhnout.',
    how: 'Kalkulačka ukáže, zda plán cíle dosáhne, kdy se tak stane a co byste mohli změnit, abyste ho dosáhli.',
  }),
  goalTarget: (c) => ({
    title: 'Cílová částka',
    what: 'Částka, kterou chcete mít.',
    example: `Například ${c.money(baseAmount(c.s.currency, 5_000_000))} pro finanční nezávislost nebo ${c.money(baseAmount(c.s.currency, 1_000_000))} na vlastní zdroje k hypotéce.`,
  }),
  goalYear: () => ({
    title: 'Rok cíle',
    what: 'Rok plánu, do kterého chcete cíle dosáhnout.',
    how: 'Může být i po konci doby investice — plán se pak pro vyhodnocení cíle prodlouží.',
  }),
  goalReal: (c) => ({
    title: 'Cíl v dnešních cenách',
    what: 'Porovnává cíl s hodnotami očištěnými o inflaci místo nominálních.',
    example: `Při inflaci ${c.pct(infl(c))} odpovídá „${c.money(baseAmount(c.s.currency, 1_000_000))} v dnešních cenách“ za 20 let zhruba ${c.money(baseAmount(c.s.currency, 1_000_000) / realOf(1, 20, infl(c)))} nominálně.`,
    more: 'Ceny v čase rostou, proto je cíl vyjádřený v dnešních cenách poctivějším popisem toho, co si za peníze skutečně koupíte.',
  }),
  requiredContribution: (c) => {
    const g = c.computed.goal
    return {
      title: 'Potřebný vklad',
      what:
        c.s.contribMode === 'constant'
          ? 'Pravidelná částka, se kterou byste cíle dosáhli přesně v roce cíle.'
          : 'Částka měsíčně navíc k vaší časové ose, se kterou byste cíle dosáhli v roce cíle.',
      how: 'Počítá se stejným výpočtem jako vaše výsledky, takže po jejím zadání vyjde přesně cílová částka.',
      example: g && g.contribution.status === 'ok' ? `Aktuálně: ${c.money(g.contribution.value)}.` : undefined,
    }
  },
  timeToGoal: (c) => {
    const m = c.computed.goal?.timeToGoal
    return {
      title: 'Kdy dosáhnete cíle',
      what: 'Kdy váš současný plán poprvé dosáhne cílové částky, pokud v něm budete pokračovat.',
      example: m != null ? `Váš plán ho dosáhne v roce ${Math.max(1, Math.ceil(m / 12))}.` : 'Se současným plánem nebude cíle dosaženo ani do 100 let.',
    }
  },
  extraLump: () => ({
    title: 'Jeden vklad navíc dnes',
    what: 'Jednorázová částka investovaná hned teď, která by sama dorovnala chybějící částku do cíle.',
    how: 'Hodí se, pokud čekáte prémii nebo dědictví — ukáže jejich vliv na cíl.',
  }),

  /* ───────── Inflace ───────── */
  inflation: (c) => ({
    title: 'Inflace',
    what: 'Obecný růst cen, kvůli kterému si za stejné peníze časem koupíte méně.',
    how: 'Po zapnutí výsledky ukazují i hodnoty v dnešních cenách a vklady či výběry mohou s inflací růst.',
    example: `Při inflaci ${c.pct(infl(c))} ročně bude mít ${c.money(baseAmount(c.s.currency))} za 20 let podobnou kupní sílu jako dnes ${c.money(realOf(baseAmount(c.s.currency), 20, infl(c)))}.`,
  }),
  inflationRate: (c) => {
    const tot = c.computed.result?.totals
    return {
      title: 'Roční inflace',
      what: 'Předpokládaný průměrný roční růst cen.',
      example:
        tot && c.s.inflationEnabled
          ? `Při ${c.pct(c.s.inflation)} by vaše konečná hodnota ${c.money(tot.final)} odpovídala zhruba ${c.money(tot.finalReal)} v dnešních cenách.`
          : undefined,
      limit: 'Inflace se rok od roku liší; kalkulačka používá jednu průměrnou sazbu.',
    }
  },
  nominalReal: () => ({
    title: 'Nominálně vs. v dnešních cenách',
    what: 'Nominální hodnoty jsou skutečné budoucí částky; hodnoty v dnešních cenách ukazují, co by za ně šlo koupit dnes.',
    how: 'Přepínáním uvidíte, jaká část růstu je „skutečná“ a jaká jen vyrovnává růst cen.',
  }),

  /* ───────── Poplatky ───────── */
  fees: () => ({
    title: 'Poplatky za investování',
    what: 'Náklady fondů, platforem nebo poradců. Strhávají se z vašich peněz a snižují dlouhodobý růst.',
    how: 'Podporované jsou tři typy: roční poplatek z hodnoty, vstupní poplatek v % z každého vkladu a pevný poplatek za vklad. Výsledky je zahrnují automaticky.',
    more: 'I poplatky se „úročí“: peníze odvedené na poplatku už nemohou růst. Za desítky let tak i 1 % ročně může stát mnohem víc, než kolik vidíte na výpisech. Sekce „Dopad poplatků“ ukazuje zaplacené poplatky i ušlé zhodnocení.',
  }),
  feeAnnual: (c) => {
    const fee = c.s.fees.annual > 0 ? c.s.fees.annual : 1
    const d = feeDrag(baseAmount(c.s.currency), rate(c), fee, 30)
    return {
      title: 'Roční poplatek',
      what: 'Roční procento z hodnoty portfolia, například celková nákladovost fondu (TER) nebo poplatek za správu.',
      how: 'Strhává se postupně každý měsíc po zhodnocení.',
      example: `${c.money(baseAmount(c.s.currency))} za 30 let při ${c.pct(rate(c))}: bez poplatků ${c.money(d.without)}, s ročním poplatkem ${c.pct(fee, 2)} ${c.money(d.withFee)}.`,
    }
  },
  feeEntry: (c) => {
    const e = c.s.fees.entry > 0 ? c.s.fees.entry : 2
    const a = monthly(c)
    return {
      title: 'Vstupní poplatek',
      what: 'Procento strhávané z každého vkladu před investováním, včetně počátečního vkladu.',
      example: `Vstupní poplatek ${c.pct(e, 2)} z vkladu ${c.money(a)} stojí ${c.money(depositFee(a, e, 0))} — investuje se jen zbytek.`,
    }
  },
  feeFixed: (c) => {
    const fx = c.s.fees.fixed > 0 ? c.s.fees.fixed : baseAmount(c.s.currency, 50)
    return {
      title: 'Pevný poplatek za vklad',
      what: 'Pevná částka účtovaná za každý vklad, například transakční poplatek.',
      how: 'Nejvíc se projeví u malých nebo častých vkladů. Nikdy nepřesáhne samotný vklad.',
      example: `${c.money(fx)} za 12 měsíčních vkladů dělá ${c.money(perYear(fx, 'monthly'))} ročně.`,
    }
  },
  feeImpact: (c) => {
    const nf = c.computed.noFee
    const tot = c.computed.result?.totals
    return {
      title: 'Dopad poplatků',
      what: 'O kolik je vaše konečná hodnota nižší kvůli poplatkům.',
      how: 'Porovnává váš plán se stejným plánem bez poplatků. Rozdíl tvoří zaplacené poplatky plus zhodnocení, které by tyto peníze jinak vydělaly.',
      example: nf && tot ? `Zde: celkem o ${c.money(nf.final - tot.final)} méně, z toho ${c.money(tot.fees)} jsou skutečně zaplacené poplatky.` : undefined,
    }
  },

  /* ───────── Výběry ───────── */
  withdrawals: () => ({
    title: 'Výběry',
    what: 'Pravidelné vybírání peněz z portfolia, například v důchodu.',
    how: 'Výběry snižují zůstatek, zbytek se dál zhodnocuje. Pokud jsou větší než zhodnocení, může se portfolio vyčerpat.',
    limit: 'Počítá se se stálým výnosem. Na skutečných trzích může pár špatných let na začátku důchodu vyčerpat portfolio dřív — viz sekce Riziko.',
  }),
  withdrawalAmount: (c) => ({
    title: 'Četnost výplat',
    what: 'Jak často se peníze vyplácejí: měsíčně, čtvrtletně nebo jednou ročně.',
    how: 'Částky se vždy zobrazují jako měsíční ekvivalent (roční součet ÷ 12), aby šly plány s různou četností férově porovnat.',
    example: `${c.money(c.s.retirement.income)} měsíčně vyplácených čtvrtletně znamená ${c.money(perYear(c.s.retirement.income, 'monthly') / 4)} na jednu výplatu.`,
  }),
  withdrawalStart: (c) => ({
    title: 'Začátek výběrů',
    what: 'Rok plánu, ve kterém proběhne první výběr.',
    example:
      c.s.startAge != null
        ? `Rok ${c.s.withdrawal.startYear} začíná ve věku ${c.s.startAge + c.s.withdrawal.startYear - 1} let.`
        : `Rok ${c.s.withdrawal.startYear} začíná po ${c.s.withdrawal.startYear - 1} letech investování.`,
  }),
  withdrawalEnd: () => ({
    title: 'Doba výběrů',
    what: 'Zda výběry pokračují až do konce plánu, nebo skončí ve zvoleném roce.',
  }),
  withdrawalIndexed: (c) => ({
    title: 'Každoročně navyšovat rentu o inflaci',
    what: 'Jednou ročně zvýší váš příjem v důchodu o inflaci, takže si během důchodu zachová kupní sílu.',
    how: 'Týká se jen let po začátku výběrů. Jak částka roste před důchodem, určuje volba „V dnešních cenách / Při začátku výběrů“.',
    example: `${c.money(baseAmount(c.s.currency, 40_000))} měsíčně při inflaci ${c.pct(infl(c))} bude ve druhém roce ${c.money(nextYearContribution(baseAmount(c.s.currency, 40_000), infl(c)))}.`,
  }),
  withdrawalStop: () => ({
    title: 'Ukončit vklady',
    what: 'Pokud je zapnuto, pravidelné vklady skončí v roce, kdy začnou výběry.',
    how: 'Vypněte, pokud chcete současně investovat i vybírat.',
  }),
  sustainable: (c) => {
    const v = c.computed.sustainable
    return {
      title: 'Udržitelný výběr',
      what: 'Nejvyšší výběr — u pevné částky částka, u pravidla 4 % a dynamických výběrů počáteční míra —, při kterém simulované portfolio vyplatí všechny plánované výběry až do konce plánu.',
      how: 'Počítá se stejnou simulací a se stejnými předpoklady jako vaše výsledky, včetně navyšování o inflaci, je-li zapnuté. U „% z aktuální hodnoty“ se nezobrazuje — tento způsob portfolio z principu nevyčerpá.',
      example: v ? (v.kind === 'rate' ? `Pro váš plán: počáteční míra zhruba ${c.pct(v.value * 100)}.` : Number.isFinite(v.value) ? `Pro váš plán: zhruba ${c.money(v.value)} za ${PER[c.s.withdrawal.frequency]}.` : undefined) : undefined,
      limit: 'Nejde o zaručeně bezpečnou částku. Skutečné výnosy kolísají a pár špatných let v nevhodnou dobu může výsledek změnit.',
    }
  },
  shortfall: () => ({
    title: 'Nevyplacené výběry',
    what: 'Součet výběrů, které už nešlo vyplatit, protože portfolio bylo prázdné.',
  }),

  /* ───────── Důchod a finanční nezávislost ───────── */
  fixedWithdrawal: (c) => {
    const p = plannedIncome(c.s, c.computed.result)
    return {
      title: 'Pevná částka',
      what: 'Sami si určíte, kolik chcete měsíčně dostávat. Plán tuto částku vybírá, dokud ji portfolio dokáže vyplatit.',
      how: 'Určují ji dvě samostatné volby: zda je částka v dnešních cenách, nebo při začátku výběrů, a zda se během důchodu navyšuje o inflaci.',
      example: p ? `Váš plán: ${c.money(p.firstMonthly)} měsíčně v prvním roce výběrů (rok ${p.startYear}).` : undefined,
      limit: 'Částka je plán. Pokud se portfolio vyčerpá, vyplatí se jen to, co v něm zbývá.',
    }
  },
  amountBasis: (c) => {
    const years = Math.max(0, c.s.withdrawal.startYear - 1)
    const a = c.s.retirement.income
    const rate = c.s.inflationEnabled ? c.s.inflation : 0
    const grown = a / realOf(1, years, rate)
    return {
      title: 'V dnešních cenách, nebo při začátku výběrů?',
      what: 'Říká kalkulačce, co zadaná částka znamená.',
      how: '„V dnešních cenách“: kupní síla, kterou chcete mít — do začátku výběrů se navyšuje o inflaci. „Při začátku výběrů“: skutečná částka, kterou budete v prvním roce vybírat, použije se beze změny.',
      example: years > 0 && rate !== 0 ? `${c.money(a)} v dnešních cenách odpovídá po ${years} ${years === 1 ? 'roce' : 'letech'} inflace ${c.pct(rate)} zhruba ${c.money(grown)}. Zadáno „při začátku výběrů“ zůstane ${c.money(a)} — dnes by to odpovídalo zhruba ${c.money(realOf(a, years, rate))}.` : undefined,
      more: 'Ani jedna volba nemění, jak se příjem vyvíjí po začátku důchodu — o tom rozhoduje samostatný přepínač „Každoročně navyšovat rentu o inflaci“. Inflace se nikdy nezapočítá dvakrát.',
    }
  },
  inflationBefore: (c) => ({
    title: 'Inflace před důchodem',
    what: 'Mezi dneškem a začátkem výběrů ceny rostou.',
    how: 'Navyšuje se o ni jen částka zadaná v dnešních cenách. Procentní strategie ji nepotřebují: jejich částka už vychází z odhadované budoucí hodnoty portfolia.',
    example: `Při ${c.pct(infl(c))} ročně odpovídá ${c.money(baseAmount(c.s.currency, 40_000))} dnes zhruba ${c.money(baseAmount(c.s.currency, 40_000) / realOf(1, 32, infl(c)))} za 32 let.`,
  }),
  inflationDuring: (c) => ({
    title: 'Inflace během důchodu',
    what: 'Zda váš příjem po začátku výběrů každý rok roste.',
    how: 'Zapnuto: příjem si zachová kupní sílu. Vypnuto: částka zůstává stejná a každý rok si za ni koupíte o něco méně. „% z aktuální hodnoty“ tento přepínač nemá — sleduje portfolio.',
    example: `${c.money(baseAmount(c.s.currency, 40_000))} → 2. rok: ${c.money(nextYearContribution(baseAmount(c.s.currency, 40_000), infl(c)))} → 3. rok: ${c.money(nextYearContribution(nextYearContribution(baseAmount(c.s.currency, 40_000), infl(c)), infl(c)))} měsíčně.`,
  }),
  desiredVsActual: (c) => {
    const t = c.computed.result?.totals
    return {
      title: 'Plánováno vs. skutečně vyplaceno',
      what: 'Plánovaný výběr je to, co strategie požaduje; vyplacená částka je to, co portfolio skutečně dokázalo vyplatit.',
      how: 'Dokud se portfolio nevyčerpá, jsou stejné. Poté se rozdíl zobrazuje jako nekrytý.',
      example: t && t.shortfall > 0 ? `Ve vašem plánu se celkem nepodařilo vyplatit ${c.money(t.shortfall)} plánovaných výběrů.` : 'Ve vašem plánu se vyplatí všechny plánované výběry.',
    }
  },
  withdrawalStrategy: () => ({
    title: 'Strategie výběrů',
    what: 'Pravidlo, které určuje, kolik si každý rok vyberete.',
    how: 'Pevná částka: částku si zvolíte. Pravidlo 4 %: procento z počáteční hodnoty, pak se navyšuje o inflaci. % z aktuální hodnoty: každý rok se přepočítá podle portfolia. Dynamická: sleduje portfolio, ale meziroční změny jsou omezené.',
    limit: 'Žádná strategie není nejlepší vždy: stabilní příjem obvykle znamená vyšší riziko vyčerpání, přizpůsobivý příjem nižší riziko, ale méně předvídatelný rozpočet.',
  }),
  rule4: (c) => ({
    title: 'Procento z počáteční hodnoty („pravidlo 4 %“)',
    what: 'Rozpočet prvního roku je procento z hodnoty portfolia na začátku výběrů. Poté se už jen navyšuje o inflaci — pozdější vývoj trhů ho nemění.',
    example: `${c.money(baseAmount(c.s.currency, 6_000_000))} × 4 % = ${c.money(baseAmount(c.s.currency, 6_000_000) * 0.04)} ročně, tedy ${c.money((baseAmount(c.s.currency, 6_000_000) * 0.04) / 12)} měsíčně v prvním roce.`,
    limit: '4 % je historické orientační pravidlo z amerického výzkumu, nikoli zaručeně bezpečná míra. Výsledek závisí na výnosech, inflaci, poplatcích a délce důchodu.',
    more: 'Pravidlo vychází ze studií historických amerických trhů z 90. let. Protože výdaje na trhy nereagují, může krach na začátku důchodu portfolio vyčerpat — jak, ukáže zátěžový test.',
  }),
  currentPct: (c) => ({
    title: '% z aktuální hodnoty portfolia',
    what: 'Každý rok si vyberete zvolené procento z aktuální hodnoty portfolia.',
    how: 'Když portfolio klesne, sníží se i váš příjem; když roste, příjem roste. Roční rozpočet se stanoví jednou při ročním přepočtu a rozdělí do výplat.',
    example: `4 % z ${c.money(baseAmount(c.s.currency, 6_000_000))} je ${c.money(baseAmount(c.s.currency, 6_000_000) * 0.04)}; klesne-li portfolio na ${c.money(baseAmount(c.s.currency, 4_000_000))}, rozpočet dalšího roku bude ${c.money(baseAmount(c.s.currency, 4_000_000) * 0.04)} (${c.money((baseAmount(c.s.currency, 4_000_000) * 0.04) / 12)} měsíčně).`,
    limit: 'Výběr 4 % aktuální hodnoty se každý rok přizpůsobuje vývoji investic. Může omezovat riziko vyčerpání prostředků, ale nezaručuje stabilní měsíční příjem — sledujte, zda pokryje požadovaný příjem, nejen zůstatek.',
  }),
  guardrails: () => ({
    title: 'Dynamické výběry s limity',
    what: 'Cílem je každý rok procento z aktuální hodnoty portfolia, ale výdaje se oproti loňsku smějí změnit jen o omezenou míru.',
    how: 'Loňské výdaje se nejdřív navýší o inflaci; nový cíl se pak omezí třeba na +5 % nad a −2,5 % pod touto hodnotou. Volitelný minimální příjem se uplatní nakonec.',
    limit: 'Jde o jednoduché pravidlo se stropem a podlahou, nikoli o složitější pravidla Guytona a Klingera. Je to hypotetické pravidlo, ne prokázaně bezpečná strategie.',
    more: 'Omezení poklesu drží životní úroveň stabilnější ve špatných letech, omezení růstu ponechává rezervu po dobrých. Podobnou myšlenku používají například studie dynamických výdajů společnosti Vanguard.',
  }),
  withdrawalRate: (c) => ({
    title: 'Míra výběru',
    what: 'Roční výběr jako procento z hodnoty portfolia.',
    example: `Při 4 % utáhne každý ${c.money(baseAmount(c.s.currency, 1_000_000))} v portfoliu ${c.money((baseAmount(c.s.currency, 1_000_000) * 0.04) / 12)} měsíčně.`,
    limit: 'Předvolby 3–5 % jsou ilustrativní předpoklady, nikoli doporučení ani zaručeně bezpečné míry.',
  }),
  guardLimits: () => ({
    title: 'Maximální růst a pokles',
    what: 'O kolik se roční rozpočet smí zvýšit nebo snížit oproti loňským výdajům navýšeným o inflaci.',
    example: 'Při loňských 240 000, inflaci 2 % a limitech +5 % / −2,5 % zůstane letošní rozpočet zhruba mezi 238 680 a 257 040, ať trhy udělají cokoli.',
  }),
  incomeFloor: (c) => ({
    title: 'Minimální příjem',
    what: 'Měsíční částka, pod kterou dynamické výběry nikdy neklesnou.',
    how: c.s.withdrawal.floorReal ? 'Je v dnešních cenách a roste s inflací. Má přednost před limitem poklesu.' : 'Je to pevná nominální částka (převzatá ze staršího uloženého plánu). Má přednost před limitem poklesu.',
    limit: 'Minimum neznamená, že si ho portfolio může dovolit — při dlouhém poklesu trhů ho může vyčerpat.',
  }),
  desiredIncome: (c) => {
    const p = plannedIncome(c.s, c.computed.result)
    return {
      title: 'Požadovaný měsíční příjem',
      what: c.s.withdrawal.strategy === 'fixed' ? 'Měsíční příjem, který chcete v důchodu vybírat.' : 'Příjem, který byste chtěli — výsledky ukážou, zda ho vaše procentní strategie skutečně dosáhne.',
      how: c.s.retirement.real ? 'Zadáno v dnešních cenách: do začátku výběrů se navyšuje o inflaci, aby si zachovalo stejnou kupní sílu.' : 'Zadáno jako skutečná částka při začátku výběrů: použije se beze změny.',
      example: p && c.s.withdrawal.strategy === 'fixed' ? `Zadali jste ${c.money(c.s.retirement.income)}; v roce ${p.startYear} plán vybírá ${c.money(p.firstMonthly)} měsíčně.` : undefined,
    }
  },
  retirementIncome: () => ({
    title: 'Příjem v důchodu',
    what: 'Peníze, které vaše výběry skutečně vyplatí, vyjádřené jako měsíční částka pro každý rok důchodu.',
    how: 'Pokud portfolio plánovaný výběr nezvládne, počítá se jen to, co bylo opravdu vyplaceno.',
  }),
  realIncome: () => ({
    title: 'Příjem v dnešních cenách',
    what: 'Příjem v důchodu přepočtený na dnešní kupní sílu.',
    how: 'Pevný výběr navyšovaný o inflaci tu zůstává rovný. Výběr, který se nenavyšuje, pomalu klesá.',
  }),
  lowestIncome: () => ({
    title: 'Nejnižší měsíční příjem',
    what: 'Nejmenší měsíční příjem v kterémkoli celém roce důchodu.',
    how: 'U přizpůsobivých strategií je důležitější než průměr: z toho byste museli žít v nejhorším modelovaném roce.',
  }),
  incomeFunding: (c) => ({
    title: 'Pokryje plán váš příjem?',
    what: `Ověřuje, zda každý celý rok důchodu vyplatí alespoň požadovaných ${c.money(c.s.retirement.income)} měsíčně${c.s.retirement.real ? ' v dnešních cenách' : ''}.`,
    how: 'Kladný zůstatek sám nestačí — strategie, která příjem sníží téměř na nulu, sice „přežije“, ale váš život neutáhne.',
  }),
  requiredCapital: (c) => ({
    title: 'Potřebný kapitál',
    what: 'Kolik by portfolio mělo mít na začátku výběrů, aby pokrylo požadovaný příjem.',
    how: 'U procentních strategií: roční příjem ÷ míra výběru. U pevné částky se dopočítá simulací tak, aby výběry vydržely do konce plánu.',
    example: `${c.money(baseAmount(c.s.currency, 50_000))} měsíčně = ${c.money(baseAmount(c.s.currency, 600_000))} ročně; při 4 % je potřeba ${c.money(baseAmount(c.s.currency, 600_000) / 0.04)}.`,
    limit: 'Procentní vzorec je orientační plánovací pravidlo, ne důkaz udržitelnosti příjmu. Daně nejsou zahrnuty.',
  }),
  financialIndependence: () => ({
    title: 'Finanční nezávislost',
    what: 'První rok, kdy vaše portfolio dosáhne kapitálu potřebného pro požadovaný příjem, pokud budete dál investovat podle plánu.',
    how: 'Je-li příjem zadán v dnešních cenách, potřebný kapitál roste s inflací.',
    limit: 'Dosažení kapitálu ještě neznamená zaručený příjem — zda strategie obstojí, ukáže kontrola udržitelnosti a sekce Riziko.',
  }),
  retirementHorizon: () => ({
    title: 'Délka důchodu',
    what: 'Jak dlouho mají výběry trvat — od prvního roku do konce plánu nebo do zvoleného posledního roku.',
    how: 'Delší důchod potřebuje pro stejnou míru jistoty nižší míru výběru.',
  }),
  sequenceRisk: () => ({
    title: 'Riziko pořadí výnosů',
    what: 'Stejný průměrný výnos může vést k velmi odlišným výsledkům podle toho, kdy přijdou špatné roky.',
    how: 'Nejvíc škodí ztráty hned po začátku výběrů: prodáváte investice levně a tyto peníze už se nezotaví.',
  }),
  stressTest: () => ({
    title: 'Zátěžový test',
    what: 'Přehraje váš plán s hypotetickým tržním šokem na začátku důchodu a porovná ho s běžnou projekcí.',
    how: 'Krach je jednorázový propad na začátku prvního roku výběrů — až po stanovení rozpočtu na ten rok a před první výplatou. Scénáře slabých let nahradí výnos v prvních letech důchodu.',
    limit: 'Jde o hypotetické scénáře, nikoli předpovědi skutečné krize.',
  }),
  strategyCompare: () => ({
    title: 'Srovnání strategií',
    what: 'Čtyři strategie výběrů na stejném plánu: stejné spoření, výnosy, inflace, poplatky i délka důchodu.',
    limit: 'Žádná strategie nevyhrává ve všem: porovnejte stabilitu příjmu s rizikem vyčerpání.',
  }),
  incomeProbability: (c) => ({
    title: 'Šance, že pokryjete příjem',
    what: `Podíl simulovaných průběhů, ve kterých každý celý rok důchodu vyplatil alespoň ${c.money(c.s.retirement.income)} měsíčně${c.s.retirement.real ? ' v dnešních cenách' : ''}.`,
    how: 'Je to přísnější — a poctivější — měřítko než „portfolio se nevyčerpalo“.',
    limit: 'Popisuje tento zjednodušený model, ne skutečné trhy.',
  }),

  /* ───────── Další nastavení ───────── */
  lumps: (c) => ({
    title: 'Jednorázové vklady',
    what: 'Samostatné vklady navíc v konkrétním roce — prémie, dědictví nebo peníze z prodeje.',
    how: 'Každý se investuje na začátku zvoleného roku a od té doby se zhodnocuje.',
    example: `${c.money(baseAmount(c.s.currency, 50_000))} vložených v 5. roce třicetiletého plánu se zhodnocuje 26 let.`,
  }),
  startAge: () => ({
    title: 'Věk na začátku',
    what: 'Nepovinné. Na časové ose, v grafu a ve výsledcích zobrazí váš věk místo pouhých roků plánu.',
    how: 'Nic se o vás neukládá ani neodesílá; věk mění jen popisky.',
  }),

  /* ───────── Výsledky ───────── */
  projected: (c) => ({
    title: 'Odhadovaná hodnota',
    what: 'Kolik by portfolio mělo na konci plánu za vašich předpokladů.',
    example: c.computed.result ? `Váš plán: ${c.money(c.computed.result.totals.final)}.` : undefined,
    limit: 'Jde o projekci, ne o slib — předpokládá každý rok stejný výnos.',
  }),
  assumptions: () => ({
    title: 'Hypotetická projekce',
    what: 'Všechny výsledky jsou výpočty z vámi zadaných předpokladů, nikoli předpovědi.',
    how: 'Předpokládají stálý výnos, zadané poplatky a nezahrnují daně. Jak nejisté jsou skutečné výsledky, ukazuje sekce Riziko.',
  }),
  todayMoney: (c) => ({
    title: 'V dnešních cenách',
    what: 'Budoucí částka přepočtená na dnešní kupní sílu podle zadané inflace.',
    example: c.computed.result ? `Za ${c.money(c.computed.result.totals.final)} na konci si koupíte zhruba tolik jako dnes za ${c.money(c.computed.result.totals.finalReal)}.` : undefined,
  }),
  contributed: (c) => ({
    title: 'Vloženo',
    what: 'Všechny peníze, které jste vložili sami: počáteční vklad, pravidelné vklady a jednorázové vklady.',
    example: c.computed.result ? `Váš plán: ${c.money(c.computed.result.totals.contributed)}.` : undefined,
  }),
  gain: () => ({
    title: 'Výnos z investic',
    what: 'Kolik investice vydělaly navíc k penězům, které jste vložili — po odečtení poplatků.',
    how: 'Počítá se jako konečná hodnota plus výběry minus vklady.',
  }),
  gainShare: (c) => {
    const tot = c.computed.result?.totals
    return {
      title: 'Výnos vs. vklady',
      what: 'Podíl konečné hodnoty, který tvoří zhodnocení, nikoli vaše vlastní vklady.',
      example: tot && tot.final > 0 ? `Z ${c.money(tot.final)} jsou ${c.money(tot.contributed)} vaše vklady a ${c.money(tot.netGain)} zhodnocení.` : undefined,
      more: 'U dlouhých plánů bývá zhodnocení často větší než všechno, co jste vložili — to je složené úročení: výnosy začnou vydělávat další výnosy.',
    }
  },
  withdrawalStartValue: () => ({
    title: 'Hodnota na začátku výběrů',
    what: 'Kolik má portfolio ve chvíli prvního výběru.',
    how: 'U plánů s výběry je to nejužitečnější hlavní údaj: tolik jste si naspořili na fázi výběrů.',
  }),
  depletion: (c) => ({
    title: 'Vyčerpání portfolia',
    what: 'Rok, kdy už portfolio nedokáže vyplatit celý výběr.',
    how: 'Oddálit ho můžete nižšími výběry, pozdějším začátkem, vyššími vklady nebo vyšším předpokládaným výnosem.',
    example: c.computed.result?.totals.depletedAtMonth != null ? `Ve vašem plánu dojdou peníze v roce ${Math.ceil(c.computed.result.totals.depletedAtMonth / 12)}.` : 'Ve vašem plánu peníze vydrží až do konce.',
  }),
  withdrawn: (c) => ({
    title: 'Celkem vybráno',
    what: 'Součet všech skutečně vyplacených výběrů.',
    example: c.computed.result ? `Váš plán: ${c.money(c.computed.result.totals.withdrawn)}.` : undefined,
  }),
  endValue: () => ({
    title: 'Konečná hodnota',
    what: 'Co zbude na konci plánu po všech výběrech.',
  }),
  peak: () => ({
    title: 'Nejvyšší hodnota',
    what: 'Nejvyšší hodnota, které portfolio během plánu dosáhne.',
  }),
  chart: () => ({
    title: 'Vývoj v čase',
    what: 'Modrá plocha je hodnota portfolia, písková čára peníze, které jste vložili. Rozdíl mezi nimi je zhodnocení.',
    how: 'Přesné hodnoty zobrazíte najetím, klepnutím nebo šipkami. „Dnešní ceny“ ukazují hodnotu očištěnou o inflaci a nominální hodnotu přerušovaně.',
  }),
  milestones: () => ({
    title: 'Milníky',
    what: 'Důležité okamžiky ve vaší projekci — například kdy zhodnocení převýší vklady nebo kdy dosáhnete cíle.',
  }),
  insights: () => ({
    title: 'Postřehy',
    what: 'Krátká zjištění spočítaná z vašeho plánu, třeba vliv o něco vyššího vkladu.',
    how: 'Každé je spočítané stejným výpočtem jako vaše výsledky.',
  }),
  sensitivity: (c) => ({
    title: 'Citlivost na výnos',
    what: `Váš plán přepočtený s výnosem o 2 procentní body nižším a vyšším (${c.pct(c.s.annualReturn - 2)} a ${c.pct(c.s.annualReturn + 2)}).`,
    how: 'Ukazuje, jak moc výsledek závisí na předpokládaném výnosu.',
    limit: 'Jde o jiné předpoklady, nikoli o pravděpodobnosti ani interval spolehlivosti.',
  }),
  yearTable: () => ({
    title: 'Přehled po letech',
    what: 'Projekce rok po roku: počáteční hodnota, vklady, výběry, zhodnocení, poplatky a konečná hodnota.',
    how: 'Každý řádek přesně sedí: počáteční hodnota + vklady − výběry + zhodnocení − poplatky = konečná hodnota.',
  }),

  /* ───────── Srovnání ───────── */
  compare: () => ({
    title: 'Srovnání scénářů',
    what: 'Až čtyři verze vašeho plánu vedle sebe, spočítané stejným způsobem.',
    how: 'Vytvořte variantu (vyšší vklad, jiný výnos, delší doba, poplatek navíc) a porovnejte výsledky. Scénáře se ukládají jen v tomto prohlížeči.',
  }),
  compareDiff: () => ({
    title: 'Rozdíly',
    what: 'O kolik se každý scénář liší od prvního.',
    limit: 'Mezi scénáři v různých měnách se rozdíly nezobrazují, protože se částky nikdy nepřepočítávají.',
  }),

  /* ───────── Riziko ───────── */
  monteCarlo: () => ({
    title: 'Simulace Monte Carlo',
    what: 'Spočítá váš plán mnohokrát s náhodně kolísajícími výnosy a ukáže rozpětí možných výsledků.',
    how: 'Místo jedné čáry vidíte vějíř: uprostřed typický výsledek, na okrajích šťastnější a méně šťastné průběhy.',
    limit: 'Pravděpodobnosti popisují tento zjednodušený model, ne skutečné trhy. Krachy a dlouhé propady mohou být horší, než model předpokládá.',
    more: 'Měsíční výnosy se losují nezávisle z log-normálního rozdělení kolem očekávaného výnosu. Vklady, poplatky, výběry i inflace jsou stejné jako ve vašem plánu.',
  }),
  riskReturn: (c) => ({
    title: 'Očekávaný výnos v simulaci',
    what: `Simulace bere ${c.pct(c.s.annualReturn)} z vašeho plánu jako typický (mediánový) roční výnos.`,
    how: 'Změníte ho v sekci Plán. Polovina simulovaných průběhů skončí nad mediánem, polovina pod ním.',
  }),
  volatility: (c) => ({
    title: 'Volatilita',
    what: 'Jak moc roční výnosy kolísají kolem očekávaného výnosu.',
    how: 'Vyšší volatilita rozšiřuje rozpětí výsledků.',
    example: `Při volatilitě ${c.pct(c.extra?.vol ?? 15)} skončí zhruba dva roky ze tří v rozmezí asi ±${c.pct(c.extra?.vol ?? 15)} kolem očekávaného výnosu.`,
    more: 'Široké akciové indexy měly historicky roční volatilitu kolem 15–20 %, dluhopisy výrazně nižší. Jde o vstup, ne o předpověď.',
  }),
  simulations: () => ({
    title: 'Počet simulací',
    what: 'Kolik náhodných průběhů se spočítá.',
    how: 'Víc simulací dává hladší a stabilnější percentily. Pevné náhodné semínko zajišťuje opakovatelnost; „Spustit znovu“ použije nové.',
  }),
  median: (c) => ({
    title: 'Mediánový výsledek',
    what: 'Prostřední výsledek: polovina simulovaných průběhů skončí výš, polovina níž.',
    example: c.extra?.median != null ? `Zde: ${c.money(c.extra.median)}.` : undefined,
  }),
  percentiles: (c) => ({
    title: 'Percentily',
    what: 'Kde v rozpětí výsledky leží. 10. percentil znamená, že 10 % průběhů skončilo níž; 90. percentil, že 90 % skončilo níž.',
    example: c.extra?.p10 != null && c.extra?.p90 != null ? `8 z 10 simulovaných průběhů skončilo mezi ${c.money(c.extra.p10)} a ${c.money(c.extra.p90)}.` : undefined,
  }),
  goalProbability: (c) => ({
    title: 'Šance na dosažení cíle',
    what: 'Podíl simulovaných průběhů, které do roku cíle dosáhly cílové částky.',
    example: c.extra?.goalProb != null ? `Cíle dosáhlo ${c.pct(c.extra.goalProb * 100, 0)} průběhů.` : undefined,
    limit: 'Jde o vlastnost modelu, ne o záruku v reálném světě.',
  }),
  depletionProbability: () => ({
    title: 'Šance, že dojdou peníze',
    what: 'Podíl simulovaných průběhů, ve kterých výběry vyčerpaly portfolio před koncem plánu.',
  }),
}
