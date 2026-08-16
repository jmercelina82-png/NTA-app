# FSB NTA 8025 Rapportage App

Interne tool voor FSB Onderhoudsbedrijf BV om NTA 8025-woninginspecties uit te
voeren en te rapporteren. Statische site + Netlify Functions, gedeelde login
(één PIN voor alle monteurs, geen per-gebruiker-accounts).

## Operationeel beheer

**Roteer de PIN periodiek**, en in ieder geval bij:
- een personeelswijziging (iemand vertrekt of komt tijdelijk niet meer),
- verlies of vervanging van een apparaat waarop is ingelogd,
- elk vermoeden dat de PIN breder bekend is geraakt dan de bedoeling was.

Aanpassen via Netlify: Site settings → Environment variables → `APP_PIN`.
Na wijzigen een nieuwe deploy triggeren (of de variabele opnieuw opslaan) zodat
de functions de nieuwe waarde oppikken. Bestaande sessies (max. 8 uur geldig)
blijven werken tot ze verlopen - er is geen directe "log iedereen uit"-knop.

Er is bewust geen gebruikersbeheer, rollen- of rechtensysteem: de gebruiker is
zowel monteur als verantwoordelijke, en dat is een geaccepteerde afweging, geen
tekortkoming. Zie `netlify/functions/lib/_shared.js` (`logActie`) voor de
lichte server-side logging van wijzig-/verzend-/verwijderacties die als
vangnet dient bij een gedeelde login.
