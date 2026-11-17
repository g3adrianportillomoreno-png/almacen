-- ==============================================================
-- MIGRACIÓN DE CHECKPOINTS / PUNTOS DE RESTAURACIÓN MANUALES (CDM ALMACÉN)
-- ==============================================================
-- Instrucciones:
-- 1. Ve a tu panel de Supabase:
--    https://supabase.com/dashboard/project/zlbdozidauhuekbvcmif/sql
-- 2. Pega este contenido y presiona "Run" (Ejecutar).
-- 3. ¡Listo! Los 5 espacios de checkpoints se sincronizarán en la nube
--    entre todas las computadoras de la bodega y oficina.
-- ==============================================================

CREATE TABLE IF NOT EXISTS public.system_checkpoints (
  id TEXT PRIMARY KEY, -- ej: 'MASTER_1', 'RECEPTIONS_3'
  category TEXT NOT NULL, -- 'MASTER' o 'RECEPTIONS'
  slot_index INTEGER NOT NULL, -- 1 a 5
  name TEXT, -- Etiqueta o nota opcional
  item_count INTEGER DEFAULT 0,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_cat_slot ON public.system_checkpoints(category, slot_index);

ALTER TABLE public.system_checkpoints ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'system_checkpoints' AND policyname = 'Permitir todo a anon en system_checkpoints'
  ) THEN
    CREATE POLICY "Permitir todo a anon en system_checkpoints" 
    ON public.system_checkpoints 
    FOR ALL 
    TO anon 
    USING (true) 
    WITH CHECK (true);
  END IF;
END $$;
