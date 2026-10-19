-- PLAYZONE | Ejecutar SOLO después de desplegar dispatch-reminders con mode=tasks.
-- No modifica ni reemplaza playzone-resumen-diario; no cambia tablas de clientes.
-- Requiere extensiones pg_cron, pg_net y secretos Vault existentes.
-- Se ejecuta cada minuto (es posible un retraso de 1-2 minutos por red/servicio).
-- NO PEGAR secretos en este archivo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'playzone-tareas-cada-minuto') THEN
    RAISE NOTICE 'El cron de tareas ya existe; no se crea un duplicado.';
  ELSE
    PERFORM cron.schedule(
      'playzone-tareas-cada-minuto',
      '* * * * *',
      $job$
      SELECT net.http_post(
        url := (
          SELECT trim(decrypted_secret)
          FROM vault.decrypted_secrets
          WHERE name = 'playzone_project_url'
        ) || '/functions/v1/dispatch-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'playzone_cron_secret'
          )
        ),
        body := '{"mode":"tasks"}'::jsonb,
        timeout_milliseconds := 20000
      );
      $job$
    );
    RAISE NOTICE 'Cron de tareas push creado.';
  END IF;
END;
$$;

-- Verificación sin revelar secretos:
SELECT jobname, schedule, active,
       CASE WHEN command LIKE '%"mode":"tasks"%'
            THEN 'MODO TAREAS' ELSE 'REVISAR' END AS modo
FROM cron.job
WHERE jobname IN ('playzone-resumen-diario', 'playzone-tareas-cada-minuto')
ORDER BY jobname;
