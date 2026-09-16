# ClientFlow Pro

Application SaaS autonome et installable (PWA) pour les professionnels : clients, champs personnalisés, rendez-vous, confirmations 48 h avant, factures, relances d'impayés, personnalisation et abonnement mensuel.

## Démarrage local

1. Installez Node.js 22.13 ou plus récent.
2. Copiez `.env.example` vers `.env` et changez `SESSION_SECRET` et `CRON_SECRET`.
3. Lancez `npm start`.
4. Ouvrez `http://localhost:3000` et créez le premier compte.

Aucune dépendance npm n'est nécessaire. La base SQLite est créée dans `data/clientflow.sqlite`.

## Envois automatiques

Appelez toutes les 15 minutes :

```text
POST /api/cron/reminders
Authorization: Bearer VOTRE_CRON_SECRET
```

Le traitement envoie :

- la demande de confirmation du rendez-vous selon le délai choisi (48 h par défaut) ;
- les relances de factures en retard selon le délai configuré ;
- un e-mail et/ou un SMS selon les préférences de l'entreprise et du client.

Les liens reçus permettent au client de confirmer ou d'annuler sans créer de compte.

## Services externes

- E-mail : clé Resend et expéditeur vérifié.
- SMS : compte Twilio, API Key et Messaging Service.
- Paiement : produit/prix récurrent Stripe et webhook vers `/api/stripe/webhook`.

## Déploiement

Le projet fonctionne sur tout hébergeur acceptant Docker avec un disque persistant. Placez-le derrière HTTPS et sauvegardez régulièrement le volume `clientflow_data`.

## Sécurité et RGPD avant commercialisation

- utilisez HTTPS et des secrets longs ;
- signez un contrat de sous-traitance avec les prestataires d'e-mail, SMS et hébergement ;
- ajoutez vos mentions légales, CGV, politique de confidentialité et registre de traitements ;
- ne stockez pas de données sensibles inutiles ;
- définissez une durée de conservation et une procédure d'export/suppression ;
- effectuez un audit de sécurité indépendant avant d'accueillir des données réelles.
