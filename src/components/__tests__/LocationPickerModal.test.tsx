// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationPickerModal } from "../LocationPickerModal";
import type { EntryLocation } from "../../types";

const JAKARTA: EntryLocation = {
  latitude: -6.2088,
  longitude: 106.8456,
  formattedAddress: "Jakarta, Indonesia",
  placeId: "ChIJ-jakarta",
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function renderModal(overrides: Partial<React.ComponentProps<typeof LocationPickerModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    onSaveLocation: vi.fn(),
    ...overrides,
  };
  return { ...render(<LocationPickerModal {...props} />), props };
}

/** Installs a geolocation stub that resolves to the given coordinates. */
function stubGeolocation(coords: { latitude: number; longitude: number }) {
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords } as GeolocationPosition)
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ location: JAKARTA })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "geolocation");
});

describe("LocationPickerModal", () => {
  it("renders nothing while closed", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("defaults to Kuala Lumpur when no location is attached yet", () => {
    renderModal();
    expect(screen.getByLabelText(/Latitude/)).toHaveValue(3.139);
    expect(screen.getByLabelText(/Longitude/)).toHaveValue(101.6869);
    expect(screen.getByText(/Kuala Lumpur/)).toBeInTheDocument();
  });

  it("prefills from an already-attached location", () => {
    renderModal({ currentLocation: JAKARTA });
    expect(screen.getByLabelText(/Latitude/)).toHaveValue(-6.2088);
    expect(screen.getByLabelText(/Longitude/)).toHaveValue(106.8456);
    expect(screen.getByDisplayValue("Jakarta, Indonesia")).toBeInTheDocument();
  });

  describe("address search", () => {
    it("is disabled until the user types something", async () => {
      renderModal();
      const search = screen.getByRole("button", { name: "Search" });
      expect(search).toBeDisabled();
      await userEvent.type(screen.getByPlaceholderText(/Putrajaya/), "Tokyo");
      expect(search).toBeEnabled();
    });

    it("geocodes the query and applies the resolved coordinates", async () => {
      const { container } = renderModal();
      await userEvent.type(screen.getByPlaceholderText(/Putrajaya/), "Jakarta");
      await userEvent.click(screen.getByRole("button", { name: "Search" }));

      await waitFor(() => expect(screen.getByLabelText(/Latitude/)).toHaveValue(-6.2088));
      expect(screen.getByLabelText(/Longitude/)).toHaveValue(106.8456);
      expect(screen.getByText("Jakarta, Indonesia")).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith("/api/maps/geocode", expect.objectContaining({
        method: "POST",
      }));
      // The map preview follows the resolved coordinates.
      expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
        "-6.2088,106.8456"
      );
    });

    it("submits on Enter as well as on the button", async () => {
      renderModal();
      await userEvent.type(screen.getByPlaceholderText(/Putrajaya/), "Jakarta{Enter}");
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    });

    it("trims the query before sending it", async () => {
      renderModal();
      await userEvent.type(screen.getByPlaceholderText(/Putrajaya/), "   Jakarta   ");
      await userEvent.click(screen.getByRole("button", { name: "Search" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.address).toBe("Jakarta");
    });

    it("surfaces the server's rejection message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ error: "Address length cannot exceed 250 characters." }, 400))
      );
      renderModal();
      await userEvent.type(screen.getByPlaceholderText(/Putrajaya/), "x");
      await userEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(await screen.findByText(/Address length cannot exceed/)).toBeInTheDocument();
    });

    it("surfaces a transport failure", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network down"); }));
      renderModal();
      await userEvent.type(screen.getByPlaceholderText(/Putrajaya/), "x");
      await userEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(await screen.findByText("Network down")).toBeInTheDocument();
    });
  });

  describe("GPS", () => {
    it("reverse-geocodes the device position", async () => {
      stubGeolocation({ latitude: 1.3521, longitude: 103.8198 });
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Use Current GPS/ }));

      await waitFor(() => expect(screen.getByLabelText(/Latitude/)).toHaveValue(1.3521));
      expect(fetch).toHaveBeenCalledWith(
        "/api/maps/reverse-geocode",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("keeps the coordinates and falls back to a pinned label when reverse geocoding fails", async () => {
      stubGeolocation({ latitude: 1.3521, longitude: 103.8198 });
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Use Current GPS/ }));

      expect(await screen.findByText("Pinned Location (1.3521, 103.8198)")).toBeInTheDocument();
      expect(screen.getByLabelText(/Latitude/)).toHaveValue(1.3521);
    });

    it("falls back to a pinned label when the server returns no location", async () => {
      stubGeolocation({ latitude: 1.3521, longitude: 103.8198 });
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Use Current GPS/ }));
      expect(await screen.findByText(/Pinned Location \(1\.3521, 103\.8198\)/)).toBeInTheDocument();
    });

    it("reports a denied permission to the user", async () => {
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition: vi.fn((_ok: unknown, fail: PositionErrorCallback) =>
            fail({ message: "User denied Geolocation" } as GeolocationPositionError)
          ),
        },
        configurable: true,
      });
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Use Current GPS/ }));
      expect(await screen.findByText("User denied Geolocation")).toBeInTheDocument();
    });

    it("reports a browser with no geolocation support", async () => {
      Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Use Current GPS/ }));
      expect(
        await screen.findByText(/Geolocation is not supported by your browser/)
      ).toBeInTheDocument();
    });
  });

  describe("manual coordinate entry and validation", () => {
    it("saves coordinates that are in range", async () => {
      const { props } = renderModal();
      await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));
      expect(props.onSaveLocation).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 3.139, longitude: 101.6869 })
      );
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it("refuses to save an out-of-range latitude", async () => {
      const { props } = renderModal();
      const lat = screen.getByLabelText(/Latitude/);
      await userEvent.clear(lat);
      await userEvent.type(lat, "91");
      await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));

      expect(await screen.findByText(/Latitude must strictly be between/)).toBeInTheDocument();
      expect(props.onSaveLocation).not.toHaveBeenCalled();
      // The dialog stays open so the user can correct the value.
      expect(props.onClose).not.toHaveBeenCalled();
    });

    it("refuses to save an out-of-range longitude", async () => {
      const { props } = renderModal();
      const lng = screen.getByLabelText(/Longitude/);
      await userEvent.clear(lng);
      await userEvent.type(lng, "181");
      await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));

      expect(await screen.findByText(/Longitude must strictly be between/)).toBeInTheDocument();
      expect(props.onSaveLocation).not.toHaveBeenCalled();
    });

    it("refuses to save when a coordinate field is emptied", async () => {
      const { props } = renderModal();
      await userEvent.clear(screen.getByLabelText(/Latitude/));
      await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));

      expect(await screen.findByText(/must be numerical coordinates/)).toBeInTheDocument();
      expect(props.onSaveLocation).not.toHaveBeenCalled();
    });

    it("accepts the exact boundaries", async () => {
      const { props } = renderModal();
      // fireEvent.change rather than userEvent.type: a number input rejects the
      // lone "-" as an intermediate value, so typing a negative sign by sign
      // never reaches -90. This models a paste or a spinner instead.
      fireEvent.change(screen.getByLabelText(/Latitude/), { target: { value: "-90" } });
      fireEvent.change(screen.getByLabelText(/Longitude/), { target: { value: "180" } });
      await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));
      expect(props.onSaveLocation).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: -90, longitude: 180 })
      );
    });

    it("clears the error once the coordinate is corrected", async () => {
      renderModal();
      fireEvent.change(screen.getByLabelText(/Latitude/), { target: { value: "91" } });
      await userEvent.click(screen.getByRole("button", { name: /Pin to Journal/ }));
      expect(await screen.findByText(/Latitude must strictly be between/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Latitude/), { target: { value: "45" } });
      await waitFor(() =>
        expect(screen.queryByText(/Latitude must strictly be between/)).not.toBeInTheDocument()
      );
    });
  });

  describe("closing", () => {
    it("cancels without saving", async () => {
      const { props } = renderModal();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(props.onClose).toHaveBeenCalledOnce();
      expect(props.onSaveLocation).not.toHaveBeenCalled();
    });

    it("offers removal only when a location is already attached", async () => {
      const { unmount } = renderModal();
      expect(screen.queryByRole("button", { name: /Remove Location/ })).not.toBeInTheDocument();
      unmount();

      const { props } = renderModal({ currentLocation: JAKARTA });
      await userEvent.click(screen.getByRole("button", { name: /Remove Location/ }));
      // undefined is how the parent learns to detach the location.
      expect(props.onSaveLocation).toHaveBeenCalledWith(undefined);
      expect(props.onClose).toHaveBeenCalledOnce();
    });
  });
});
