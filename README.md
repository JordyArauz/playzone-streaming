# PlayZone - Streaming

Aplicación web local para gestionar ventas, cuentas, perfiles/clientes, vencimientos, pagos y observaciones de servicios de streaming.

## Tecnologías

- React + Vite
- CSS responsive
- Guardado local con localStorage
- Preparada para migrar después a Supabase
- Preparada para subir a GitHub y desplegar en Vercel

## Cómo abrir el proyecto

1. Extrae el ZIP.
2. Abre la carpeta `playzone-streaming` con Visual Studio Code.
3. Abre una terminal dentro del proyecto.
4. Ejecuta:

```bash
npm install
npm run dev
```

5. Abre el enlace local que te muestre Vite, normalmente:

```bash
http://localhost:5173
```

## Primera versión estable

Esta versión todavía no usa Supabase. Guarda la información en el navegador mediante `localStorage` para probar rápido la interfaz y el flujo de trabajo.

Incluye:

- Dashboard con resumen general.
- Registro de ventas/perfiles/clientes.
- Registro de cuentas de streaming.
- Búsqueda por cliente, contacto, plataforma o cuenta.
- Filtros por plataforma y estado.
- Edición y eliminación.
- Vencimientos próximos.
- Exportar copia de seguridad en JSON.
- Importar copia de seguridad JSON.
- Borrar todos los datos locales.

## Importante

Los datos guardados en `localStorage` quedan solo en el navegador donde se usa la app. Para usar la app desde celular, PC y web con datos compartidos, después se debe conectar a Supabase.

Para datos sensibles como contraseñas reales, lo correcto será usar login y base de datos protegida cuando pasemos a Supabase.
