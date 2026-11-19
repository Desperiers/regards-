# Regards : inspection de bâtiments et vidéo par drone

Regards est une application installable sur **Mac, iPhone, iPad et Android**. Elle couvre tout le travail après le vol : on importe les photos et vidéos du drone, on relève les désordres (à la main ou avec l'IA) et on produit un rapport d'inspection en PDF.

## Fonctionnalités

- **Projets** (un par bâtiment ou par chantier) : adresse, client, date, type de mission, drone, télépilote, météo et cadre réglementaire.
- **Import des photos et vidéos** par glisser-déposer, sélection de fichiers ou appareil photo du téléphone.
  - Lecture automatique des **métadonnées du drone** : GPS, altitude, hauteur relative, cap, inclinaison de la nacelle (EXIF/XMP DJI).
- **Lecteur vidéo d'inspection** :
  - avance image par image, ralenti et accéléré (×0,25 à ×4) ;
  - **repères horodatés** avec une note ;
  - **capture d'image** : l'image capturée devient une photo annotable ;
  - extraction automatique d'une image toutes les N secondes.
- **Annotation des désordres** sur les photos (rectangle, cercle, flèche) :
  - type (fissure, infiltration, tuile, corrosion, zinguerie…) ;
  - gravité sur 4 niveaux, localisation, description, recommandation ;
  - statut : à vérifier, à traiter, en cours ou traité.
- **Détection IA** : Claude analyse une photo ou toutes les photos d'un projet et propose les désordres avec leur zone. Ces propositions arrivent avec le statut « À vérifier ».
- **Tableau des désordres** avec indicateurs, filtres et export **CSV** (Excel).
- **Rapport PDF** :
  - page de garde avec logo, fiche mission et synthèse par gravité ;
  - tableau récapitulatif ;
  - une fiche par désordre (photo annotée et zoom) et une galerie en annexe.
  - La synthèse peut être rédigée par l'IA.
- **Hors-ligne et privé** : tout est stocké sur l'appareil. Une sauvegarde `.json` permet de passer un projet du Mac au téléphone.

## Installation

L'application est un site statique, sans serveur ni compilation. Elle est publiée automatiquement par GitHub Pages (`.github/workflows/pages.yml`) :

1. Sur GitHub, ouvrez **Settings → Pages → Source : GitHub Actions**.
2. Après le déploiement, ouvrez l'adresse `https://<votre-compte>.github.io/<dépôt>/` :
   - **Mac (Safari)** : menu Fichier → *Ajouter au Dock*. Avec Chrome : icône d'installation dans la barre d'adresse.
   - **iPhone / iPad (Safari)** : Partager → *Sur l'écran d'accueil*.
   - **Android (Chrome)** : menu ⋮ → *Installer l'application*.

Pour tester en local : `cd app && python3 -m http.server 8000`, puis ouvrir http://localhost:8000.

## Analyse IA

Dans **Réglages**, collez une clé API Anthropic (créée sur console.anthropic.com). La clé reste sur l'appareil. Seules les photos que vous choisissez d'analyser sont envoyées à l'API, et chaque analyse est facturée sur votre compte Anthropic.

## Structure

```
app/
  index.html            page principale
  app.js                application (base locale IndexedDB, vues, annotation, vidéo, IA, rapport)
  styles.css            styles écran et impression
  sw.js                 fonctionnement hors-ligne
  manifest.webmanifest  installation comme application
```
