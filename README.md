# Gym Tracker

Pequeña app web (PWA) para apuntar rutinas, pesos y descansos del gimnasio. Uso personal.

- Funciona sin conexión y se instala en la pantalla de inicio.
- Los datos se guardan solo en cada móvil (localStorage); nada se sube a ningún servidor.

## Instalar

- **iPhone:** abrir el enlace en Safari → Compartir → "Añadir a pantalla de inicio".
- **Android:** abrir en Chrome → menú ⋮ → "Instalar aplicación".

## Probar en local

```bash
python -m http.server 5173
```

Al publicar cambios, sube la versión de `CACHE` en `sw.js` para que los móviles se actualicen.
