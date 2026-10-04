-- Etapa 2.1: clasificación visual de tareas. No elimina registros.
-- Aplicar DESPUÉS de 20261001_recordatorios.sql si aún no existe la tabla.
-- Es segura para recordatorios anteriores: se asigna importancia Media por defecto.
BEGIN;
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'media';
-- Comprobar compatibilidad de filas anteriores o ingresadas manualmente.
UPDATE public.reminders
   SET priority = 'media'
 WHERE priority IS NULL OR priority NOT IN ('baja','media','alta');
ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_priority_check;
ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_priority_check CHECK (priority IN ('baja','media','alta'));
COMMIT;
