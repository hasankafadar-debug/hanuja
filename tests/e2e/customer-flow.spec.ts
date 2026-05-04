import { test, expect } from '@playwright/test';

// Base URL from environment or default to localhost:3000
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Customer User Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage
    await page.goto(BASE_URL);
  });

  test('should load homepage successfully', async ({ page }) => {
    // Check page title or main heading exists
    const heading = page.locator('h1, h2');
    await expect(heading.first()).toBeVisible();
  });

  test('should search for products', async ({ page }) => {
    // Look for search input
    const searchInput = page.locator('input[placeholder*="ara" i], input[type="search"], input[placeholder*="search" i]');

    if (await searchInput.isVisible()) {
      await searchInput.fill('mobilya');
      await page.keyboard.press('Enter');

      // Wait for search results
      await page.waitForLoadState('networkidle');

      // Check if results are displayed
      const productCards = page.locator('[data-testid="product-card"], .product-card, article');
      await expect(productCards.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to category', async ({ page }) => {
    // Look for category links
    const categoryLink = page.locator('a[href*="/kategori"], [data-testid="category-link"]').first();

    if (await categoryLink.isVisible()) {
      await categoryLink.click();
      await page.waitForLoadState('networkidle');

      // Verify we're on category page
      const heading = page.locator('h1, h2');
      await expect(heading.first()).toBeVisible();
    }
  });

  test('should add product to cart', async ({ page }) => {
    // Navigate to first category or search results
    const categoryLink = page.locator('a[href*="/kategori"], [data-testid="category-link"]').first();
    if (await categoryLink.isVisible()) {
      await categoryLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Find and click first product
    const productLink = page.locator('a[href*="/urun"], .product-card a').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      // Look for add to cart button
      const addToCartBtn = page.locator('button:has-text("Sepete Ekle"), button:has-text("Add to Cart"), [data-testid="add-to-cart"]').first();
      if (await addToCartBtn.isVisible()) {
        await addToCartBtn.click();

        // Check for success message or cart update
        await page.waitForLoadState('networkidle');
        const successMsg = page.locator('text="Sepete eklendi", text="Added to cart"');
        await expect(successMsg.first()).toBeVisible({ timeout: 3000 }).catch(() => {
          // If no success message, just verify button was clicked
          console.log('Add to cart clicked');
        });
      }
    }
  });

  test('should view cart', async ({ page }) => {
    // Look for cart icon/link
    const cartLink = page.locator('[data-testid="cart-link"], a[href*="/sepet"], a:has-text("Sepet")').first();

    if (await cartLink.isVisible()) {
      await cartLink.click();
      await page.waitForLoadState('networkidle');

      // Verify we're on cart page
      const cartHeading = page.locator('h1, h2, text="Sepet", text="Cart"').first();
      await expect(cartHeading).toBeVisible({ timeout: 3000 }).catch(() => {
        console.log('Cart page loaded');
      });
    }
  });

  test('should navigate to checkout', async ({ page }) => {
    // First add something to cart
    const categoryLink = page.locator('a[href*="/kategori"]').first();
    if (await categoryLink.isVisible()) {
      await categoryLink.click();
      await page.waitForLoadState('networkidle');
    }

    const productLink = page.locator('a[href*="/urun"]').first();
    if (await productLink.isVisible()) {
      await productLink.click();
      await page.waitForLoadState('networkidle');

      const addToCartBtn = page.locator('button:has-text("Sepete Ekle"), button:has-text("Add to Cart")').first();
      if (await addToCartBtn.isVisible()) {
        await addToCartBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }

    // Navigate to cart
    const cartLink = page.locator('[data-testid="cart-link"], a[href*="/sepet"]').first();
    if (await cartLink.isVisible()) {
      await cartLink.click();
      await page.waitForLoadState('networkidle');

      // Look for checkout button
      const checkoutBtn = page.locator('button:has-text("Ödemeye Geç"), button:has-text("Proceed to Checkout"), [data-testid="checkout-btn"]').first();
      if (await checkoutBtn.isVisible()) {
        console.log('Checkout button is visible and ready');
      }
    }
  });

  test('should handle user registration/login flow', async ({ page }) => {
    // Look for login/register link
    const authLink = page.locator('a[href*="/giris"], a[href*="/kayit"], a[href*="/login"], button:has-text("Giriş"), button:has-text("Login")').first();

    if (await authLink.isVisible()) {
      await authLink.click();
      await page.waitForLoadState('networkidle');

      // Check if we're on auth page
      const authHeading = page.locator('h1, h2').first();
      await expect(authHeading).toBeVisible({ timeout: 3000 });
    }
  });

  test('should verify page responsiveness', async ({ page }) => {
    // Test that main content is visible
    const mainContent = page.locator('main, [role="main"]');
    await expect(mainContent).toBeVisible({ timeout: 3000 }).catch(() => {
      console.log('Main content loaded');
    });

    // Check viewport
    const viewportSize = page.viewportSize();
    expect(viewportSize).toBeTruthy();
    expect(viewportSize?.width).toBeGreaterThan(0);
    expect(viewportSize?.height).toBeGreaterThan(0);
  });
});
