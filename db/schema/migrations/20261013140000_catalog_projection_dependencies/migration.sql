-- A lost queue enqueue must not leave visibility or labels stale in search.
CREATE FUNCTION mark_catalog_projection_dependencies_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_index_dirty_products ("productId",revision,"updatedAt")
    SELECT id,1,CURRENT_TIMESTAMP FROM products
      WHERE TG_TABLE_NAME <> 'sellers' OR "sellerId" = NEW.id
    ON CONFLICT ("productId") DO UPDATE SET
      revision=search_index_dirty_products.revision+1,"updatedAt"=CURRENT_TIMESTAMP;
  RETURN NULL;
END $$;
CREATE TRIGGER sellers_search_visibility_dirty
  AFTER UPDATE OF status,"vacationModeEnabled",slug,"displayName" ON sellers
  FOR EACH ROW EXECUTE FUNCTION mark_catalog_projection_dependencies_dirty();
CREATE TRIGGER categories_search_schema_dirty
  AFTER UPDATE OF name,"templateCode","isActive" ON categories
  FOR EACH ROW EXECUTE FUNCTION mark_catalog_projection_dependencies_dirty();
