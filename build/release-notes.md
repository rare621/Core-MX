Version 1.0.16 rebuilds the pages around the new top navigation introduced in 1.0.15. This update also adjusts gear-picker button sizes and refreshes the Graphics layout.

Rebuilt pages:
- Get Mods: tiles explain each source (Free mods, Add-ons, MXB Hub, MX Bikes Shop), with a big search bar, category icons and a featured banner.
- Rider: a showroom stage, plus a floating "Unsaved changes" bar with Revert and Apply to game.
- My Mods: one-click summary tiles (installed, updates, turned off, duplicates, favorites).
- Play: a track banner with a big Ride button and numbered bike/track picks.
- Online: server rows show rider counts and ping colours, next to "Friends riding now" with Join.
- Friends: a profile card and friend cards.
- Settings: a side menu.
- OEM Packs: "Update all" for packs you already have.
- Downloads: status counts.

Clearer names: Game is now Play, its Settings tab is Game settings, and bike appearance is only on Rider > Bike.

Get Mods no longer freezes: page parsing now runs in the background, so scrolling and clicking stay responsive while results load.

Smarter "needs another mod" checks: the app now picks the best matching installed model instead of the first loose match, and it no longer treats a different generation (for example Tech 7 vs Tech 10, or 2018 vs 2021) as installed. Rider models (such as hoodie bodies) are now checked too. Templates and other links are ignored, and tracks and whole bikes no longer show a "needs another model" warning.

Rider > Bike: the section is now labelled Livery.

Safety: delete and uninstall actions can never remove the mods folder itself, even if an install record is damaged.
