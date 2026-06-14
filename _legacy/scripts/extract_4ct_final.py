import pdfplumber
import re

pdf_path = "/Users/ally/Downloads/Round Price List 01.30.2026.pdf"

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages, 1):
        text = page.extract_text()
        
        # Look for 4.00-4.99 section
        if "4.00" in text and "4.99" in text:
            print(f"Found 4.00-4.99 table on page {page_num}")
            print("=" * 50)
            
            # Extract lines
            lines = text.split('\n')
            
            # Find lines with F color data
            for line in lines:
                # Look for F followed by numbers
                if re.match(r'^F\s+\d', line.strip()):
                    print(f"\nF color row: {line}")
                    
                    # Extract all numbers
                    numbers = re.findall(r'\d+', line)
                    if len(numbers) >= 11:
                        clarities = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'SI3', 'I1', 'I2', 'I3']
                        print("\nParsed values:")
                        for c, v in zip(clarities, numbers[:11]):
                            print(f"  {c}: {v}")
                        
                        # Calculate price for 4.45 F SI1 -47%
                        si1_value = int(numbers[5])
                        carat = 4.45
                        discount = 0.47
                        
                        list_price_per_ct = si1_value * 100
                        total_list_price = list_price_per_ct * carat
                        final_price = total_list_price * (1 - discount)
                        
                        print(f"\n=== PRICE CALCULATION ===")
                        print(f"Stone: RBC 4.45 F SI1")
                        print(f"Rapaport 4.00-4.99 F SI1: {si1_value}")
                        print(f"List Price/ct: ${list_price_per_ct:,}")
                        print(f"Total List Price: ${total_list_price:,}")
                        print(f"Discount: -47%")
                        print(f"\n*** FINAL PRICE: USD ${final_price:,.2f} ***")
                        break
            break
