-- CreateEnum
CREATE TYPE "ProductAttributeType" AS ENUM ('color', 'material');

-- CreateTable
CREATE TABLE "product_attribute_options" (
    "id" TEXT NOT NULL,
    "type" "ProductAttributeType" NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "hexColor" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_attribute_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attribute_options" (
    "categoryId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "category_attribute_options_pkey" PRIMARY KEY ("categoryId","optionId")
);

-- CreateTable
CREATE TABLE "product_attribute_values" (
    "productId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("productId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_options_type_slug_key" ON "product_attribute_options"("type", "slug");

-- CreateIndex
CREATE INDEX "product_attribute_options_type_isActive_idx" ON "product_attribute_options"("type", "isActive");

-- CreateIndex
CREATE INDEX "category_attribute_options_categoryId_idx" ON "category_attribute_options"("categoryId");

-- CreateIndex
CREATE INDEX "product_attribute_values_productId_idx" ON "product_attribute_values"("productId");

-- CreateIndex
CREATE INDEX "product_attribute_values_optionId_idx" ON "product_attribute_values"("optionId");

-- AddForeignKey
ALTER TABLE "category_attribute_options" ADD CONSTRAINT "category_attribute_options_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attribute_options" ADD CONSTRAINT "category_attribute_options_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "product_attribute_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "product_attribute_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
