# Estima Paris

Application simple d'estimation du prix d'un appartement parisien, construite à partir de `selogerdata.csv`.

Le jeu de données brut n'est pas distribué avec ce dépôt. L'application reste autonome grâce aux actifs pré-calculés dans `app/data/` (modèle et agrégats du dashboard).

## Fonctionnalités

- estimation du prix d'annonce et fourchette calibrée à 90 % ;
- formulaire par arrondissement, surface, pièces, chambres, balcon et cuisine ;
- indicateurs de marché recalculés par arrondissement ;
- comparaison du prix médian au m² et nuage surface/prix ;
- avertissements lorsque la couverture des données est limitée.

Le modèle embarqué utilise 3 644 annonces d'appartements parisiens dédupliquées et structurellement valides. Sa validation croisée donne environ 15,3 % d'erreur relative moyenne. Il estime un prix d'annonce, pas un prix de transaction notariale.

## Lancer l'application

Prérequis : Node.js 22.13 ou plus récent.

```bash
npm install
npm run dev
```

Contrôles disponibles :

```bash
npm run build
npm run lint
npm test
```

## Périmètre

La première version est volontairement limitée aux appartements des 20 arrondissements de Paris, entre 14 et 250 m². La source ne contient ni date de collecte fiable, ni état du bien, ni DPE, ni prix de vente final ; l'estimation reste donc indicative.
