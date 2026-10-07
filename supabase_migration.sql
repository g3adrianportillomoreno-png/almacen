-- ==============================================================
-- MIGRACIÓN DE BASE DE DATOS SUPABASE
-- Sistema de Recepción y Control de Almacén (CDM)
-- ==============================================================
-- Copia y pega este script en el editor SQL de tu panel de Supabase:
-- https://supabase.com/dashboard/project/zlbdozidauhuekbvcmif/sql

-- 1. Agregar columnas para el número consecutivo y folio en 'checklists'
ALTER TABLE public.checklists 
ADD COLUMN IF NOT EXISTS consecutive_number INTEGER;

ALTER TABLE public.checklists 
ADD COLUMN IF NOT EXISTS folio TEXT;

-- 2. Agregar columnas para fila de almacén, número de inventario y estado en 'expected_series'
ALTER TABLE public.expected_series 
ADD COLUMN IF NOT EXISTS warehouse_row TEXT DEFAULT 'Sin Asignar';

ALTER TABLE public.expected_series 
ADD COLUMN IF NOT EXISTS warehouse_name TEXT DEFAULT 'Almacén 1';

ALTER TABLE public.expected_series 
ADD COLUMN IF NOT EXISTS warehouse_space TEXT;

ALTER TABLE public.expected_series 
ADD COLUMN IF NOT EXISTS internal_number INTEGER;

ALTER TABLE public.expected_series 
ADD COLUMN IF NOT EXISTS printer_status TEXT DEFAULT 'DISPONIBLE';

ALTER TABLE public.expected_series 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- 3. Tabla para almacenar la configuración y coordenadas del mapa del almacén
CREATE TABLE IF NOT EXISTS public.warehouse_map_config (
  id TEXT PRIMARY KEY DEFAULT 'default_layout',
  layout JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Habilitar permisos de lectura y escritura para anon en las nuevas columnas y tablas
ALTER TABLE public.warehouse_map_config ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'warehouse_map_config' AND policyname = 'Permitir todo a anon en warehouse_map_config'
  ) THEN
    CREATE POLICY "Permitir todo a anon en warehouse_map_config" 
    ON public.warehouse_map_config 
    FOR ALL 
    TO anon 
    USING (true) 
    WITH CHECK (true);
  END IF;
END $$;
