import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../../App';

describe('fuck_PDF Anti-Slop UI & Core Flows', () => {
  it('renders All PDF Tools main menu and verifiable local telemetry without fake badges', () => {
    render(<App />);
    expect(screen.getAllByText(/Semua Alat PDF/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Merge PDF/i)).toBeInTheDocument();
    expect(screen.getByText(/Protect PDF/i)).toBeInTheDocument();
    expect(screen.getByText(/Seret & Lepas File Apa Saja ke Sini/i)).toBeInTheDocument();
    expect(screen.getByText(/Pemrosesan Lokal/i)).toBeInTheDocument();
    expect(screen.getAllByText(/0 KB/i).length).toBeGreaterThan(0);

    // Anti-slop honesty check: must NOT contain fake certifications
    expect(screen.queryByText(/ISO Certified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Military Grade/i)).not.toBeInTheDocument();
  });

  it('allows opening a tool from the menu, updating the navbar, and purging memory', () => {
    render(<App />);
    const unlockCard = screen.getByRole('button', { name: /Unlock PDF/i });
    fireEvent.click(unlockCard);
    expect(screen.getByText(/MODUL A · PASSWORD UNLOCKER & EXTRACTOR/i)).toBeInTheDocument();

    const purgeBtn = screen.getByRole('button', { name: /Tutup & Hapus Memori/i });
    fireEvent.click(purgeBtn);
    expect(screen.getByText(/Memori dibersihkan/i)).toBeInTheDocument();
    expect(screen.getByText(/Seret & Lepas File Apa Saja ke Sini/i)).toBeInTheDocument();
  });
});
