# Subtitle Game

## Lancer le serveur

Assurez-vous que le dossier `public/` est au même niveau que l’exécutable `subtitle_game.exe`.

```
subtitle_game.exe
public/
├─ config.json
├─ videos/
├─ library_videos/
└─ vendor/
```

Double-cliquez sur `subtitle_game.exe` pour démarrer le serveur.
Une console va s’ouvrir et afficher les logs du serveur.

Vous pouvez maintenant accéder à l’interface du jeu, gérer les clips et les sous-titres.

Ouvrez votre navigateur et allez à l’adresse :
http://localhost:3000 et lisez la video pour démarrer le tutoriel !

## Rajouter des videos dans la librairie

Ajouter le dossier `library_videos/` dans `public/` (s'il n'existe pas deja)

Créer un dossier avec cette structure:

```
nom_video/
├─ nom_video.srt
├─ nom_video.mp4
```

Puis dans `public/config.json` à la fin du fichier dans `library_videos`, ajouter:

```
"library_videos": [
    {
      ... une autre video
    },
    {
      "id": "nom_video",
      "lang": "la langue de l'audio",
      "path": "./library_videos/nom_video/nom_video.mp4",
      "srt": "./library_videos/nom_video/nom_video.srt"
    }
  ]
```
