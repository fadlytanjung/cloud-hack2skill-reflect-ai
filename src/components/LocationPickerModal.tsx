import React, { useState } from "react";
import { EntryLocation } from "../types";
import { MapPin, Search, Navigation, X, Check, AlertCircle } from "lucide-react";

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLocation?: EntryLocation;
  onSaveLocation: (loc: EntryLocation | undefined) => void;
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  isOpen,
  onClose,
  currentLocation,
  onSaveLocation,
}) => {
  const [addressInput, setAddressInput] = useState(currentLocation?.formattedAddress || "");
  const [latitude, setLatitude] = useState<number>(currentLocation?.latitude ?? 3.139);
  const [longitude, setLongitude] = useState<number>(currentLocation?.longitude ?? 101.6869);
  const [formattedAddress, setFormattedAddress] = useState<string>(
    currentLocation?.formattedAddress || "Kuala Lumpur, Federal Territory of Kuala Lumpur, Malaysia"
  );
  const [placeId, setPlaceId] = useState<string>(currentLocation?.placeId || "");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Validate coordinates: latitude [-90, 90], longitude [-180, 180] (Directive A)
  const validate = (lat: number, lng: number): boolean => {
    if (isNaN(lat) || isNaN(lng)) {
      setErrorMessage("Latitude and Longitude must be numerical coordinates.");
      return false;
    }
    if (lat < -90 || lat > 90) {
      setErrorMessage("Latitude must strictly be between -90 and 90 degrees.");
      return false;
    }
    if (lng < -180 || lng > 180) {
      setErrorMessage("Longitude must strictly be between -180 and 180 degrees.");
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  const handleSearchAddress = async () => {
    if (!addressInput.trim()) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/maps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addressInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to resolve geocode");
      }

      const loc = data.location;
      setLatitude(loc.latitude);
      setLongitude(loc.longitude);
      setFormattedAddress(loc.formattedAddress);
      setPlaceId(loc.placeId || "");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to geocode address");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrorMessage("Geolocation is not supported by your browser environment.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);

        try {
          const res = await fetch("/api/maps/reverse-geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude: lat, longitude: lng }),
          });
          const data = await res.json();
          if (res.ok && data.location) {
            setFormattedAddress(data.location.formattedAddress);
            setPlaceId(data.location.placeId || "");
          } else {
            setFormattedAddress(`Pinned Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
          }
        } catch {
          setFormattedAddress(`Pinned Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        } finally {
          setIsLoading(false);
        }
      },
      (err) => {
        setIsLoading(false);
        setErrorMessage(err.message || "Unable to retrieve device GPS coordinates.");
      },
      { timeout: 8000 }
    );
  };

  const handleSave = () => {
    if (!validate(latitude, longitude)) return;

    onSaveLocation({
      latitude,
      longitude,
      formattedAddress: formattedAddress.trim() || undefined,
      placeId: placeId || undefined,
    });
    onClose();
  };

  const handleRemove = () => {
    onSaveLocation(undefined);
    onClose();
  };

  // Google Maps embed URL with coordinates
  const mapEmbedUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&hl=en&z=14&output=embed`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fadeIn">
      <div
        id="location-picker-dialog"
        className="bg-[#fbf9f5] border border-[#ded7c8] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-[#e6e0d4] flex items-center justify-between bg-[#ffffff]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#eef3ed] border border-[#c9d8c6] flex items-center justify-center text-[#476340]">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#2c2b29] font-serif">Attach Journal Location</h3>
              <p className="text-[11px] text-[#7c786e]">
                Ground your reflection with location awareness (Google Maps)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#7c786e] hover:text-[#2c2b29] p-1.5 rounded-lg hover:bg-[#ede7db] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Address Search Bar */}
          <div className="space-y-1.5">
            <label htmlFor="location-address-input" className="text-xs font-medium text-[#4a4741]">Search City or Place</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#8a857a] absolute left-3 top-2.5" />
                <input
                  id="location-address-input"
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchAddress()}
                  placeholder="e.g. Putrajaya, Tokyo, Central Park..."
                  className="w-full bg-[#ffffff] border border-[#ded7c8] rounded-xl pl-9 pr-3 py-2 text-xs text-[#2c2b29] placeholder:text-[#948f85] focus:outline-hidden focus:border-[#476340]"
                />
              </div>
              <button
                onClick={handleSearchAddress}
                disabled={isLoading || !addressInput.trim()}
                className="px-3 py-2 bg-[#476340] hover:bg-[#3c5436] text-[#fdfbf7] text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-40"
              >
                Search
              </button>
            </div>
          </div>

          {/* Quick GPS button */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleUseCurrentLocation}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs text-[#476340] hover:text-[#364c31] font-medium transition cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Use Current GPS Coordinates</span>
            </button>
            <span className="text-[11px] text-[#8a857a]">Strict bounds: [-90, 90], [-180, 180]</span>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-2.5 bg-[#fdf1f1] border border-[#f2cccc] rounded-xl flex items-center gap-2 text-xs text-[#9e3838]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Interactive Map Preview */}
          <div className="relative rounded-xl overflow-hidden border border-[#ded7c8] h-48 bg-[#ede7db]">
            <iframe
              title="Google Map Preview"
              src={mapEmbedUrl}
              className="w-full h-full border-0"
              loading="lazy"
            />
            <div className="absolute bottom-2 left-2 bg-[#ffffff]/90 backdrop-blur-xs px-2.5 py-1 rounded-md text-[11px] text-[#2c2b29] border border-[#ded7c8] flex items-center gap-1.5 shadow-xs font-mono">
              <MapPin className="w-3 h-3 text-[#476340]" />
              <span>
                {latitude.toFixed(4)}, {longitude.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Fine-tune Coordinates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="location-latitude-input" className="text-[11px] text-[#7c786e] font-medium">Latitude (Deg)</label>
              <input
                id="location-latitude-input"
                type="number"
                step="0.0001"
                value={latitude}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setLatitude(val);
                  validate(val, longitude);
                }}
                className="w-full bg-[#ffffff] border border-[#ded7c8] rounded-xl px-3 py-1.5 text-xs font-mono text-[#2c2b29] focus:outline-hidden focus:border-[#476340]"
              />
            </div>
            <div>
              <label htmlFor="location-longitude-input" className="text-[11px] text-[#7c786e] font-medium">Longitude (Deg)</label>
              <input
                id="location-longitude-input"
                type="number"
                step="0.0001"
                value={longitude}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setLongitude(val);
                  validate(latitude, val);
                }}
                className="w-full bg-[#ffffff] border border-[#ded7c8] rounded-xl px-3 py-1.5 text-xs font-mono text-[#2c2b29] focus:outline-hidden focus:border-[#476340]"
              />
            </div>
          </div>

          {/* Formatted Address Tag */}
          <div className="p-2.5 bg-[#f4efe6] rounded-xl text-xs text-[#4a4741] border border-[#e4dcce]">
            <span className="font-semibold text-[#2c2b29]">Resolved Address: </span>
            <span>{formattedAddress || "Unspecified Location"}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e6e0d4] flex items-center justify-between bg-[#ffffff]">
          {currentLocation ? (
            <button
              onClick={handleRemove}
              className="text-xs text-[#9e3838] hover:text-[#782222] font-medium cursor-pointer"
            >
              Remove Location
            </button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[#6b665c] hover:bg-[#ede7db] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#476340] hover:bg-[#3c5436] text-[#fdfbf7] text-xs font-semibold rounded-xl transition cursor-pointer shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Pin to Journal</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
