import { z } from 'zod';

// Zod schema for validation
export const ProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().default('USD'),
  originalPrice: z.number().nonnegative().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url(),
  productUrl: z.string().url(),
  availability: z.boolean().default(true),
  category: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  scrapedAt: z.string().datetime(),
});

// TypeScript interface inferred from schema
export type Product = z.infer<typeof ProductSchema>;

// Schema for array of products
export const ProductArraySchema = z.array(ProductSchema);

// Partial product for extraction (before validation)
export interface RawProduct {
  id?: string | null;
  name?: string | null;
  price?: string | number | null;
  currency?: string | null;
  originalPrice?: string | number | null;
  description?: string | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  availability?: boolean | string | null;
  category?: string | null;
  rating?: string | number | null;
  reviewCount?: string | number | null;
  scrapedAt?: string;
}

// Scraping result
export interface ScrapingResult {
  success: boolean;
  products: Product[];
  totalPages: number;
  errors: ScrapingError[];
  timestamp: string;
}

export interface ScrapingError {
  page?: number;
  message: string;
  selector?: string;
  url?: string;
}

// Pagination info
export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
}
