---
"crontick-dashboard": minor
---

BREAKING: panels are now folders (`feed/<id>/card.json` + `data.json`). New alert files (`feed/alerts/<id>.json`; `title` required, `text` optional). New `new` command. Fixed three-column layout with a Completed section and All/Alerts/Cards filter. Removed size, retention, archive and layout drag (`PUT /api/layout`). `validateCardFile` removed from the library API.
