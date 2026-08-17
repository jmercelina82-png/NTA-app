// Gedeeld mutable state dat door meerdere modules gelezen en/of geschreven
// moet worden. In een eigen bestand gezet (in plaats van bijvoorbeeld
// dashboard.js) zodat form.js/autosave.js/pdf.js het kunnen lezen zonder een
// circulaire afhankelijkheid met dashboard.js nodig te hebben.
//
// Id van de inspectie die nu in het formulier open staat. Zonder id wordt er
// nooit automatisch iets aangemaakt of opgeslagen (dat gebeurt alleen expliciet
// via "+ Nieuwe inspectie").
export let huidigId = null;
export function setHuidigId(id) { huidigId = id; }

// Laatst bekende serverstand (laatstGewijzigd) van de open inspectie - de
// basis waarop de eerstvolgende save vertrouwt om te bepalen of er intussen
// al een nieuwere versie op de server staat (zie save-inspection.js en
// offline.js). Wordt bijgewerkt na elke succesvolle fetch/save, nooit
// gebaseerd op de lokale apparaatklok.
export let laatstGewijzigdBasis = null;
export function setLaatstGewijzigdBasis(t) { laatstGewijzigdBasis = typeof t === 'number' ? t : null; }

// Id van een inspectie die zojuist succesvol verzonden is (server bevestigde
// statusBijgewerkt:true), gebruikt door dashboard.js om de eerstvolgende
// dashboard-fetch een paar keer kort te herhalen als die id daar nog niet als
// 'afgerond' in staat - Blobs' list()/get() kan een fractie achterlopen op
// een zojuist gelukte schrijfactie, en zonder dit zou het dashboard tijdelijk
// nog 'Concept' tonen totdat de gebruiker zelf ververst.
export let netVerzondenId = null;
export function setNetVerzondenId(id) { netVerzondenId = id; }
