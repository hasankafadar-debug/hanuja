-- AlterTable
ALTER TABLE "order_lines" ADD COLUMN     "deliveryConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryConfirmedBy" TEXT;
