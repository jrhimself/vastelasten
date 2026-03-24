export function autoMatch(transactie, lasten, periode) {
  // Only match debits (afschrijvingen); credits (bijschrijvingen) are never vaste lasten
  if (transactie.bedrag >= 0) return null;

  if (transactie.tegenrekening) {
    const ibanLasten = lasten.filter(l =>
      l.iban_tegenrekening &&
      l.iban_tegenrekening.replace(/\s/g, '') === transactie.tegenrekening.replace(/\s/g, '')
    );
    if (ibanLasten.length === 1) return ibanLasten[0].id;
    if (ibanLasten.length > 1) {
      const match = ibanLasten.find(l => Math.abs(Math.abs(transactie.bedrag) - l.bedrag) < 0.02);
      return match ? match.id : ibanLasten[0].id;
    }
  }

  for (const last of lasten) {
    if (last.omschrijving_patroon && transactie.omschrijving) {
      try {
        const re = new RegExp(last.omschrijving_patroon, 'i');
        if (re.test(transactie.omschrijving)) return last.id;
      } catch {
        if (transactie.omschrijving.toLowerCase().includes(last.omschrijving_patroon.toLowerCase())) return last.id;
      }
    }
  }

  for (const last of lasten) {
    if (last.verwachte_dag && last.bedrag && transactie.bedrag != null) {
      const bedragMatch = Math.abs(Math.abs(transactie.bedrag) - last.bedrag) < 0.02;
      if (bedragMatch && transactie.datum && periode.start_datum) {
        const start = new Date(periode.start_datum);
        let verwacht = new Date(start);
        verwacht.setDate(last.verwachte_dag);
        if (verwacht < start) verwacht.setMonth(verwacht.getMonth() + 1);
        const tDatum = new Date(transactie.datum);
        const diffDagen = Math.abs((tDatum - verwacht) / 86400000);
        if (diffDagen <= 5) return last.id;
      }
    }
  }

  return null;
}
